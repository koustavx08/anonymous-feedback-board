/**
 * Run the compiled contract locally — no wallet, no proof server, no network.
 *
 *   npm run simulate
 *
 * This executes the real circuits emitted by `compact compile` against an
 * in-memory ledger, so it verifies the contract's actual logic rather than a
 * reimplementation of it. Circuit assertions fire exactly as they would
 * on-chain, which is what makes the negative cases below meaningful.
 */

import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  witnesses,
  createFeedbackPrivateState,
  RoundState,
  type FeedbackPrivateState,
} from '@feedback/contract';

/** Zswap coin public key. Irrelevant to this contract, so a fixed value is fine. */
const COIN_PUBLIC_KEY = '0'.repeat(64);

const randomSecretKey = (): Uint8Array => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
};

type Ctx = CircuitContext<FeedbackPrivateState>;

const readLedger = (ctx: Ctx) => ledger(ctx.currentQueryContext.state);

/** Re-point the context at a different person's private state. */
const as = (ctx: Ctx, secretKey: Uint8Array): Ctx => ({
  ...ctx,
  currentPrivateState: createFeedbackPrivateState(secretKey),
});

let passed = 0;
let failed = 0;

const check = (label: string, condition: boolean, detail = ''): void => {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/** Assert that a circuit call is rejected, and report the assertion message. */
const expectRejected = (label: string, run: () => unknown): void => {
  try {
    run();
    failed += 1;
    console.log(`  FAIL  ${label} — expected rejection, but the call succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    passed += 1;
    console.log(`  PASS  ${label} — rejected: ${message.split('\n')[0]}`);
  }
};

const main = (): void => {
  console.log('\n  Anonymous Feedback Board — local contract run\n');

  const organizerKey = randomSecretKey();
  const alice = randomSecretKey();
  const bob = randomSecretKey();

  const contract = new Contract<FeedbackPrivateState>(witnesses);
  const constructed = contract.initialState(
    createConstructorContext(createFeedbackPrivateState(organizerKey), COIN_PUBLIC_KEY),
  );

  let ctx: Ctx = createCircuitContext(
    sampleContractAddress(),
    COIN_PUBLIC_KEY,
    constructed.currentContractState,
    constructed.currentPrivateState,
  );

  // ── Constructor ──────────────────────────────────────────────────────────
  let state = readLedger(ctx);
  check('constructor opens round 1', state.round === 1n, `round=${state.round}`);
  check('board starts open', state.roundState === RoundState.open);
  check('board starts empty', state.entryCount === 0n);

  // ── Happy path ───────────────────────────────────────────────────────────
  ctx = contract.impureCircuits.submitFeedback(as(ctx, alice), 5n, 'Docs are excellent').context;
  state = readLedger(ctx);
  check('alice submission recorded', state.entryCount === 1n, `entryCount=${state.entryCount}`);
  check('rating stored publicly', state.ratings.lookup(0n) === 5n);
  check('message stored publicly', state.messages.lookup(0n) === 'Docs are excellent');
  check('one nullifier published', state.submitted.size() === 1n);

  // ── The core privacy guarantee ───────────────────────────────────────────
  expectRejected('alice cannot submit twice in the same round', () =>
    contract.impureCircuits.submitFeedback(as(ctx, alice), 3n, 'Trying again'),
  );

  // ── A different person is unaffected ─────────────────────────────────────
  ctx = contract.impureCircuits.submitFeedback(as(ctx, bob), 4n, 'Good, could be faster').context;
  state = readLedger(ctx);
  check('bob can still submit', state.entryCount === 2n, `entryCount=${state.entryCount}`);
  check('two distinct nullifiers', state.submitted.size() === 2n);

  // ── Input validation ─────────────────────────────────────────────────────
  expectRejected('rating above 5 is rejected', () =>
    contract.impureCircuits.submitFeedback(as(ctx, randomSecretKey()), 6n, 'Out of range'),
  );
  expectRejected('rating below 1 is rejected', () =>
    contract.impureCircuits.submitFeedback(as(ctx, randomSecretKey()), 0n, 'Out of range'),
  );

  // ── Organizer authorisation ──────────────────────────────────────────────
  expectRejected('non-organizer cannot close the round', () =>
    contract.impureCircuits.closeRound(as(ctx, alice)),
  );

  ctx = contract.impureCircuits.closeRound(as(ctx, organizerKey)).context;
  state = readLedger(ctx);
  check('organizer closed the round', state.roundState === RoundState.closed);

  expectRejected('closed round accepts no feedback', () =>
    contract.impureCircuits.submitFeedback(as(ctx, randomSecretKey()), 5n, 'Too late'),
  );

  // ── New round retires nullifiers ─────────────────────────────────────────
  ctx = contract.impureCircuits.openRound(as(ctx, organizerKey)).context;
  state = readLedger(ctx);
  check('round 2 is open', state.round === 2n && state.roundState === RoundState.open, `round=${state.round}`);
  check('nullifiers were retired', state.submitted.size() === 0n, `submitted=${state.submitted.size()}`);

  ctx = contract.impureCircuits.submitFeedback(as(ctx, alice), 2n, 'Round two opinion').context;
  state = readLedger(ctx);
  check('alice may submit again in a new round', state.entryCount === 3n, `entryCount=${state.entryCount}`);
  check('entry is tagged with round 2', state.entryRound.lookup(2n) === 2n);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
};

main();
