/**
 * Deploy the Anonymous Feedback Board.
 *
 *   npm run deploy -- --network preprod
 *
 * Prints the contract address to paste into `ui/.env` and the README.
 */

import * as Rx from 'rxjs';
import { FeedbackBoardAPI, isNetworkId, NETWORK_CONFIGS, type NetworkId } from '@feedback/api';
import { buildNodeProviders, createWallet, waitForProofServer } from './providers.js';

const parseNetwork = (argv: string[]): NetworkId => {
  const index = argv.indexOf('--network');
  const value = index >= 0 ? argv[index + 1] : process.env.MIDNIGHT_NETWORK;
  if (!value) return 'preprod';
  if (!isNetworkId(value)) throw new Error(`Unknown network "${value}". Use undeployed | preview | preprod.`);
  return value;
};

const main = async (): Promise<void> => {
  const network = parseNetwork(process.argv);
  const config = NETWORK_CONFIGS[network];

  const seed = process.env.MIDNIGHT_WALLET_SEED;
  if (!seed) {
    throw new Error(
      'Set MIDNIGHT_WALLET_SEED to your 64-character hex wallet seed before deploying.\n' +
        `Fund the resulting address from the faucet: ${config.faucet ?? '(local devnet — no faucet)'}`,
    );
  }

  console.log(`\n  Deploying Anonymous Feedback Board to ${network}\n`);

  console.log('  Checking proof server...');
  if (!(await waitForProofServer(config.proofServer))) {
    throw new Error(`Proof server unreachable at ${config.proofServer}. Run: docker compose up -d`);
  }
  console.log('  Proof server ready.');

  console.log('  Starting wallet and syncing (this can take a few minutes)...');
  const walletCtx = await createWallet(network, seed);
  await walletCtx.wallet.waitForSyncedState();
  console.log(`  Wallet: ${walletCtx.unshieldedKeystore.getBech32Address()}`);

  // NIGHT must be registered for DUST generation before it can pay for proofs.
  const state = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const unregistered = state.unshielded.availableCoins.filter(
    (coin: { meta?: { registeredForDustGeneration?: boolean } }) => !coin.meta?.registeredForDustGeneration,
  );
  if (unregistered.length > 0) {
    console.log(`  Registering ${unregistered.length} NIGHT UTXOs for DUST...`);
    const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
      unregistered,
      walletCtx.unshieldedKeystore.getPublicKey(),
      (payload: Uint8Array) => walletCtx.unshieldedKeystore.signData(payload),
    );
    await walletCtx.wallet.submitTransaction(await walletCtx.wallet.finalizeRecipe(recipe));
  }
  if (state.dust.balance(new Date()) === 0n) {
    console.log('  Waiting for DUST...');
    await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    );
  }

  console.log('  Deploying contract...');
  const providers = await buildNodeProviders(network, walletCtx);
  const board = await FeedbackBoardAPI.deploy(providers);

  console.log('\n  Deployed.\n');
  console.log(`  Contract address: ${board.deployedContractAddress}\n`);
  console.log('  Next steps:');
  console.log('    1. Put it in ui/.env as VITE_CONTRACT_ADDRESS=<address>');
  console.log('    2. Replace <YOUR_DEPLOYED_CONTRACT_ADDRESS> in README.md\n');

  await walletCtx.wallet.stop();
};

main().catch((error) => {
  console.error(`\n  Deployment failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
