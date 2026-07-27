/**
 * Provider wiring for the browser.
 *
 * Balancing and submission are delegated to the wallet extension over the DApp
 * Connector API; proving is delegated to a proof server running on the user's
 * own machine. The private state never leaves the browser.
 */

import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  Binding,
  FinalizedTransaction,
  Proof,
  SignatureEnabled,
  Transaction,
  TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';

import type { FeedbackCircuitKeys, FeedbackProviders } from './common-types.js';

export type BrowserProviderOptions = {
  /** 'undeployed' | 'preview' | 'preprod' — passed to the wallet on connect. */
  readonly networkId: string;
  /** Local proof server, e.g. http://127.0.0.1:6300. */
  readonly proofServer: string;
  /** Where the compiled ZK keys are served from. Defaults to the page origin. */
  readonly zkConfigPath?: string;
};

type ConnectedWalletAPI = {
  getConfiguration(): Promise<{
    indexerUri: string;
    indexerWsUri: string;
    proverServerUri?: string;
  }>;
  getShieldedAddresses(): Promise<{
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }>;
  balanceUnsealedTransaction(tx: string): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<string>;
};

type InitialWalletAPI = {
  apiVersion: string;
  connect(networkId: string): Promise<ConnectedWalletAPI>;
};

const COMPATIBLE_CONNECTOR_API_MAJOR = '4';

const findWallet = (): InitialWalletAPI => {
  const injected = (globalThis as { midnight?: Record<string, unknown> }).midnight;
  if (!injected) {
    throw new Error('No Midnight wallet extension detected. Install Lace Midnight Preview or 1AM.');
  }
  for (const candidate of Object.values(injected)) {
    if (
      candidate &&
      typeof candidate === 'object' &&
      'apiVersion' in candidate &&
      typeof (candidate as InitialWalletAPI).apiVersion === 'string' &&
      (candidate as InitialWalletAPI).apiVersion.split('.')[0] === COMPATIBLE_CONNECTOR_API_MAJOR
    ) {
      return candidate as InitialWalletAPI;
    }
  }
  throw new Error(
    `No wallet exposing connector API v${COMPATIBLE_CONNECTOR_API_MAJOR}.x was found. Update your wallet extension.`,
  );
};

/**
 * Connect the wallet and assemble the full provider set the API layer needs.
 */
export const buildBrowserProviders = async (options: BrowserProviderOptions): Promise<FeedbackProviders> => {
  const wallet = findWallet();
  const connected = await wallet.connect(options.networkId);
  const config = await connected.getConfiguration();
  const shieldedAddresses = await connected.getShieldedAddresses();

  const zkConfigPath = options.zkConfigPath ?? globalThis.location?.origin ?? '';
  const zkConfigProvider = new FetchZkConfigProvider<FeedbackCircuitKeys>(zkConfigPath, fetch.bind(globalThis));

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'feedback-board-private-state',
    }),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proverServerUri ?? options.proofServer, zkConfigProvider),
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    walletProvider: {
      getCoinPublicKey: () => shieldedAddresses.shieldedCoinPublicKey,
      getEncryptionPublicKey: () => shieldedAddresses.shieldedEncryptionPublicKey,
      balanceTx: async (tx: UnboundTransaction): Promise<FinalizedTransaction> => {
        const received = await connected.balanceUnsealedTransaction(toHex(tx.serialize()));
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          'signature',
          'proof',
          'binding',
          fromHex(received.tx),
        );
      },
    },
    midnightProvider: {
      submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
        await connected.submitTransaction(toHex(tx.serialize()));
        return tx.identifiers()[0];
      },
    },
  } as FeedbackProviders;
};
