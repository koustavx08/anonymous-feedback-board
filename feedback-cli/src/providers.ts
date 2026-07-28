/**
 * Node-side provider wiring: a headless wallet built from a seed, a local
 * proof server, and the public indexer.
 *
 * Mirrors the wallet/provider setup used by the official Midnight scaffolds
 * (`create-mn-app`), adapted to the feedback board's private state.
 */

import { Buffer } from 'node:buffer';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {
  WalletFacade,
  DustWallet,
  HDWallet,
  Roles,
  ShieldedWallet,
  createKeystore,
  NoOpTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk';

import {
  resolveNetworkConfig as resolveConfigWithOverrides,
  type NetworkConfig,
  type NetworkId,
  type FeedbackProviders,
} from '@feedback/api';

// The wallet SDK syncs over a websocket, which Node does not expose globally.
(globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where `compact compile` put the circuit keys and verifier data. */
export const ZK_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'contract', 'src', 'managed', 'feedback');

export const resolveNetworkConfig = (network: NetworkId): NetworkConfig =>
  resolveConfigWithOverrides(network);

const deriveKeys = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid wallet seed');
  const result = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hdWallet.hdWallet.clear();
  return result.keys;
};

export type WalletContext = {
  wallet: Awaited<ReturnType<typeof WalletFacade.init>>;
  shieldedSecretKeys: ReturnType<typeof ledger.ZswapSecretKeys.fromSeed>;
  dustSecretKey: ReturnType<typeof ledger.DustSecretKey.fromSeed>;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
};

/** Build and start a wallet for the given seed. Caller awaits sync. */
export const createWallet = async (network: NetworkId, seed: string): Promise<WalletContext> => {
  const config = resolveNetworkConfig(network);
  setNetworkId(config.networkId);

  const keys = deriveKeys(seed);
  const networkId = getNetworkId();
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);

  const wallet = await WalletFacade.init({
    configuration: {
      networkId,
      indexerClientConnection: {
        indexerHttpUrl: config.indexer,
        indexerWsUrl: config.indexerWS,
      },
      provingServerUrl: new URL(config.proofServer),
      relayURL: new URL(config.node.replace(/^http/, 'ws')),
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
      costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
    },
    shielded: async (c) => ShieldedWallet(c).startWithSecretKeys(shieldedSecretKeys),
    unshielded: async (c) => UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: async (c) =>
      DustWallet(c).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

/** Assemble every provider the feedback board API needs, in Node. */
export const buildNodeProviders = async (
  network: NetworkId,
  walletCtx: WalletContext,
): Promise<FeedbackProviders> => {
  const config = resolveNetworkConfig(network);
  const zkConfigProvider = new NodeZkConfigProvider(ZK_CONFIG_PATH);

  const privateStatePassword =
    process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: unknown, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx as never,
        {
          shieldedSecretKeys: walletCtx.shieldedSecretKeys,
          dustSecretKey: walletCtx.dustSecretKey,
        },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: unknown) => walletCtx.wallet.submitTransaction(tx as never),
  };

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'feedback-board-state',
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  } as unknown as FeedbackProviders;
};

/** Poll the proof server until it answers, or give up. */
export const waitForProofServer = async (url: string, attempts = 30, delayMs = 2000): Promise<boolean> => {
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
      return true;
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code ?? '';
      if (code !== 'ECONNREFUSED' && code !== 'UND_ERR_CONNECT_TIMEOUT' && code !== 'UND_ERR_SOCKET') return true;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
};
