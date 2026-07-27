#!/usr/bin/env node
/**
 * Interactive CLI for the Anonymous Feedback Board.
 *
 *   npm run preprod-remote        # join a board on preprod and interact
 *
 * Requires: a compiled contract (`npm run compact`), a running proof server,
 * and a funded wallet seed in MIDNIGHT_WALLET_SEED.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as Rx from 'rxjs';

import {
  FeedbackBoardAPI,
  isNetworkId,
  NETWORK_CONFIGS,
  type FeedbackDerivedState,
  type NetworkId,
} from '@feedback/api';
import { buildNodeProviders, createWallet, waitForProofServer } from './providers.js';

const parseNetwork = (argv: string[]): NetworkId => {
  const index = argv.indexOf('--network');
  const value = index >= 0 ? argv[index + 1] : process.env.MIDNIGHT_NETWORK;
  if (!value) return 'preprod';
  if (!isNetworkId(value)) throw new Error(`Unknown network "${value}". Use undeployed | preview | preprod.`);
  return value;
};

const render = (state: FeedbackDerivedState): void => {
  console.log('\n  ─────────────────────────────────────────────');
  console.log(`  Round #${state.round}  ·  ${state.roundState === 0 ? 'OPEN' : 'CLOSED'}`);
  console.log(`  Entries: ${state.entryCount}`);
  if (state.averageRating !== undefined) {
    console.log(`  Average this round: ${state.averageRating.toFixed(1)} / 5`);
  }
  console.log(`  You: ${state.isOrganizer ? 'organizer' : 'participant'}${state.hasSubmitted ? ' (already submitted)' : ''}`);
  console.log('  ─────────────────────────────────────────────');
  for (const entry of state.entries.slice(0, 10)) {
    console.log(`  ${'*'.repeat(entry.rating).padEnd(5)}  [r${entry.round}]  ${entry.message}`);
  }
  console.log('');
};

const main = async (): Promise<void> => {
  const network = parseNetwork(process.argv);
  const config = NETWORK_CONFIGS[network];

  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress || contractAddress.startsWith('<')) {
    throw new Error('Set CONTRACT_ADDRESS to a deployed board address, or run `npm run deploy` first.');
  }
  const seed = process.env.MIDNIGHT_WALLET_SEED;
  if (!seed) throw new Error('Set MIDNIGHT_WALLET_SEED to your 64-character hex wallet seed.');

  if (!(await waitForProofServer(config.proofServer))) {
    throw new Error(`Proof server unreachable at ${config.proofServer}. Run: docker compose up -d`);
  }

  console.log(`\n  Joining ${contractAddress} on ${network}...`);
  const walletCtx = await createWallet(network, seed);
  await walletCtx.wallet.waitForSyncedState();

  const providers = await buildNodeProviders(network, walletCtx);
  const board = await FeedbackBoardAPI.join(providers, contractAddress);

  const rl = createInterface({ input: stdin, output: stdout });
  let latest: FeedbackDerivedState | undefined;
  const subscription = board.state$.subscribe((state) => {
    latest = state;
  });

  try {
    for (;;) {
      if (!latest) latest = await Rx.firstValueFrom(board.state$);
      render(latest);

      console.log('  1) Submit feedback');
      console.log('  2) Refresh');
      if (latest.isOrganizer) console.log(`  3) ${latest.roundState === 0 ? 'Close' : 'Open'} round`);
      console.log('  q) Quit');

      const choice = (await rl.question('\n  > ')).trim().toLowerCase();

      if (choice === 'q') break;

      if (choice === '1') {
        const rating = Number((await rl.question('  Rating 1-5: ')).trim());
        const message = (await rl.question('  Feedback: ')).trim();
        console.log('  Proving and submitting...');
        await board.submitFeedback(rating, message);
        console.log('  Submitted anonymously.');
      } else if (choice === '3' && latest.isOrganizer) {
        console.log('  Proving and submitting...');
        if (latest.roundState === 0) await board.closeRound();
        else await board.openRound();
        console.log('  Done.');
      }

      latest = await Rx.firstValueFrom(board.state$);
    }
  } catch (error) {
    console.error(`\n  Error: ${error instanceof Error ? error.message : String(error)}\n`);
  } finally {
    subscription.unsubscribe();
    rl.close();
    await walletCtx.wallet.stop();
  }
};

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
