/**
 * Deploy the Anonymous Feedback Board.
 *
 *   npm run deploy -- --network preprod
 *
 * Prints the contract address to paste into `ui/.env` and the README.
 */

import * as Rx from 'rxjs';
import { FeedbackBoardAPI, isNetworkId, describeOverrides, type NetworkId } from '@feedback/api';
import { buildNodeProviders, createWallet, resolveNetworkConfig, waitForProofServer } from './providers.js';

const parseNetwork = (argv: string[]): NetworkId => {
  const index = argv.indexOf('--network');
  const value = index >= 0 ? argv[index + 1] : process.env.MIDNIGHT_NETWORK;
  if (!value) return 'preprod';
  if (!isNetworkId(value)) throw new Error(`Unknown network "${value}". Use undeployed | preview | preprod.`);
  return value;
};

const main = async (): Promise<void> => {
  const network = parseNetwork(process.argv);
  const config = resolveNetworkConfig(network);

  const overridden = describeOverrides();
  if (overridden.length > 0) {
    // Names only — the URLs carry API keys.
    console.log(`  Using endpoint overrides for: ${overridden.join(', ')}`);
  }

  // The local devnet mints to a well-known genesis wallet, so it is the only
  // seed that has funds there. It always wins on `undeployed` — a personal
  // seed would simply have a zero balance.
  const GENESIS_SEED = `${'0'.repeat(63)}1`;

  const seed = network === 'undeployed' ? GENESIS_SEED : process.env.MIDNIGHT_WALLET_SEED;
  if (!seed) {
    throw new Error(
      'Set MIDNIGHT_WALLET_SEED to your 64-character hex wallet seed before deploying.\n' +
        `Fund the resulting address from the faucet: ${config.faucet ?? '(local devnet — no faucet)'}`,
    );
  }
  if (network === 'undeployed') {
    console.log('  Using the devnet genesis wallet (pre-funded).');
  }

  console.log(`\n  Deploying Anonymous Feedback Board to ${network}\n`);

  console.log('  Checking proof server...');
  if (!(await waitForProofServer(config.proofServer))) {
    throw new Error(`Proof server unreachable at ${config.proofServer}. Run: docker compose up -d`);
  }
  console.log('  Proof server ready.');

  console.log('  Starting wallet and syncing (this can take a few minutes)...');
  const walletCtx = await createWallet(network, seed);
  console.log(`  Wallet: ${walletCtx.unshieldedKeystore.getBech32Address()}`);

  // Sync can run for many minutes with no output at all, which is
  // indistinguishable from a hang. Report progress while we wait.
  const syncStarted = Date.now();

  // Wallet state is full of bigints, which JSON.stringify throws on.
  const safeJson = (value: unknown): string =>
    JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? `${inner}n` : inner)) ?? '';

  const summarise = (state: Record<string, any> | undefined): string => {
    if (!state) return 'no state yet';
    const parts: string[] = [];
    for (const kind of ['shielded', 'unshielded', 'dust'] as const) {
      const child = state[kind];
      if (child === undefined) continue;
      const synced = child.isSynced ?? child.synced ?? '?';
      const progress = child.syncProgress ?? child.progress;
      const detail =
        progress && typeof progress === 'object' ? ` ${safeJson(progress).slice(0, 70)}` : '';
      parts.push(`${kind}=${synced}${detail}`);
    }
    return parts.length > 0 ? parts.join('  ') : Object.keys(state).join(',');
  };

  let sawFirstEmission = false;
  const progressSub = walletCtx.wallet
    .state()
    .pipe(Rx.throttleTime(10_000, undefined, { leading: true, trailing: true }))
    .subscribe({
      next: (state: any) => {
        // Progress reporting must never be able to kill the deploy it watches.
        try {
          if (!sawFirstEmission) {
            sawFirstEmission = true;
            console.log(`  state keys: ${Object.keys(state ?? {}).join(', ')}`);
          }
          const seconds = Math.round((Date.now() - syncStarted) / 1000);
          console.log(`  [${seconds}s] isSynced=${state?.isSynced}  ${summarise(state)}`);
        } catch (error) {
          console.log(`  (progress log failed: ${error instanceof Error ? error.message : error})`);
        }
      },
      error: (error: unknown) => {
        console.log(`  (state stream error: ${error instanceof Error ? error.message : String(error)})`);
      },
    });

  try {
    await walletCtx.wallet.waitForSyncedState();
  } finally {
    progressSub.unsubscribe();
  }
  console.log(`  Synced in ${Math.round((Date.now() - syncStarted) / 1000)}s.`);

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
