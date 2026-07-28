/**
 * Print the wallet address for a seed, without syncing.
 *
 *   MIDNIGHT_WALLET_SEED=<64-hex> npm run address -- --network preprod
 *
 * Key derivation is purely local, so this returns instantly — unlike `deploy`,
 * which must sync the wallet before it can show you anything. Use it to find
 * the address to fund from the faucet.
 */

import { Buffer } from 'node:buffer';
import { HDWallet, Roles, createKeystore } from '@midnight-ntwrk/wallet-sdk';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { isNetworkId, NETWORK_CONFIGS, type NetworkId } from '@feedback/api';

const parseNetwork = (argv: string[]): NetworkId => {
  const index = argv.indexOf('--network');
  const value = index >= 0 ? argv[index + 1] : process.env.MIDNIGHT_NETWORK;
  if (!value) return 'preprod';
  if (!isNetworkId(value)) throw new Error(`Unknown network "${value}". Use undeployed | preview | preprod.`);
  return value;
};

const main = (): void => {
  const network = parseNetwork(process.argv);
  const config = NETWORK_CONFIGS[network];

  const seed = process.env.MIDNIGHT_WALLET_SEED;
  if (!seed) throw new Error('Set MIDNIGHT_WALLET_SEED to your 64-character hex wallet seed.');
  if (!/^[0-9a-fA-F]{64}$/.test(seed.trim())) {
    throw new Error('MIDNIGHT_WALLET_SEED must be exactly 64 hexadecimal characters.');
  }

  setNetworkId(config.networkId);

  const hdWallet = HDWallet.fromSeed(Buffer.from(seed.trim(), 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid wallet seed');
  const derived = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('Key derivation failed');
  hdWallet.hdWallet.clear();

  const keystore = createKeystore(derived.keys[Roles.NightExternal], getNetworkId());

  console.log(`\n  Network: ${network}`);
  console.log(`  Address: ${keystore.getBech32Address()}\n`);
  if (config.faucet) {
    console.log(`  Fund it here: ${config.faucet}`);
    console.log('  Funding takes 2-3 minutes to land.\n');
  }
};

try {
  main();
} catch (error) {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
