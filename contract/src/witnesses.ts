import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * Private state for the Anonymous Feedback Board.
 *
 * This never leaves the user's machine. It is held by the private-state
 * provider (browser IndexedDB via LevelDB, or an on-disk store for the CLI)
 * and is fed into circuits through the witness below. The proof that gets
 * submitted to the network is computed *over* this value without containing it.
 */
export type FeedbackPrivateState = {
  /** 32-byte secret. Identity anchor for nullifier derivation. */
  readonly secretKey: Uint8Array;
};

/** Key under which the private state is filed by the private-state provider. */
export const FEEDBACK_PRIVATE_STATE_ID = 'feedbackPrivateState';

export const createFeedbackPrivateState = (secretKey: Uint8Array): FeedbackPrivateState => {
  if (secretKey.length !== 32) {
    throw new Error(`secretKey must be exactly 32 bytes, got ${secretKey.length}`);
  }
  return { secretKey };
};

/** Cryptographically random 32-byte secret key. Works in Node 22+ and browsers. */
export const randomSecretKey = (): Uint8Array => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
};

/**
 * Witness implementations, keyed by the `witness` declarations in
 * `feedback.compact`. The generated contract calls these while building a
 * proof; the returned tuple is `[possibly-updated private state, value]`.
 *
 * Deliberately generic over the ledger type so this module type-checks before
 * `compact compile` has generated `managed/feedback/**` — the generated ledger
 * type is only needed at the call site, not here.
 */
export const witnesses = {
  localSecretKey: <L>({
    privateState,
  }: WitnessContext<L, FeedbackPrivateState>): [FeedbackPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],
};

export type FeedbackWitnesses = typeof witnesses;
