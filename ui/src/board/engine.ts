/**
 * In-browser execution of the feedback board's rules.
 *
 * This is a faithful re-implementation of the state machine in
 * `contract/src/feedback.compact` — same ledger fields, same assertions, same
 * one-submission-per-round nullifier scheme — running against localStorage
 * instead of the Midnight ledger.
 *
 * It is NOT a zero-knowledge system, and it is not bit-compatible with the
 * contract: `persistentHash` is replaced by SHA-256 over the same domain-
 * separated inputs. It exists so the UI is fully explorable without a wallet,
 * a proof server and a funded account, and so the interaction layer above it
 * has one interface to code against. Everything it enforces, the contract also
 * enforces — on-chain and in zero knowledge.
 */

import { RoundState, type BoardState, type FeedbackEntry } from './types';

const STORAGE_KEY = 'feedback-board:v1';
const SECRET_KEY_STORAGE = 'feedback-board:secret-key:v1';

type StoredState = {
  roundState: RoundState;
  round: number;
  entryCount: number;
  /** hex nullifiers of everyone who has submitted in the current round */
  submitted: string[];
  organizer: string;
  entries: FeedbackEntry[];
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const fromHex = (hex: string): Uint8Array =>
  new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));

/** 32-byte zero-padded domain separator, matching Compact's `pad(32, "...")`. */
const pad32 = (text: string): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(text).subarray(0, 32));
  return out;
};

/** big-endian 32-byte encoding of a round number, matching `round as Field as Bytes<32>`. */
const roundToBytes = (round: number): Uint8Array => {
  const out = new Uint8Array(32);
  const view = new DataView(out.buffer);
  view.setBigUint64(24, BigInt(round));
  return out;
};

/**
 * Stand-in for the contract's
 * `persistentHash<Vector<3, Bytes<32>>>([domain, item, sk])`.
 */
const hash3 = async (domain: Uint8Array, item: Uint8Array, sk: Uint8Array): Promise<string> => {
  const buf = new Uint8Array(96);
  buf.set(domain, 0);
  buf.set(item, 32);
  buf.set(sk, 64);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return toHex(new Uint8Array(digest));
};

/** The user's secret key — the one value that must never be published. */
export const getSecretKey = (): Uint8Array => {
  const stored = localStorage.getItem(SECRET_KEY_STORAGE);
  if (stored) return fromHex(stored);
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  localStorage.setItem(SECRET_KEY_STORAGE, toHex(key));
  return key;
};

/** Forget the local identity: a fresh key means a fresh, unlinkable nullifier. */
export const rotateSecretKey = (): void => {
  localStorage.removeItem(SECRET_KEY_STORAGE);
};

const publicKey = (sk: Uint8Array, domain: string): Promise<string> =>
  hash3(pad32('feedback:pk:'), pad32(domain), sk);

const nullifierFor = (sk: Uint8Array, round: number): Promise<string> =>
  hash3(pad32('feedback:nul:'), roundToBytes(round), sk);

const seedEntries: FeedbackEntry[] = [
  {
    id: '2',
    rating: 5,
    message:
      'Sprint retro actually changed something this time — the on-call rotation fix landed the same week. Please keep that momentum.',
    round: 1,
    at: Date.now() - 1000 * 60 * 60 * 6,
  },
  {
    id: '1',
    rating: 2,
    message:
      'Honestly, the release process is still painful. Three approvals for a one-line config change is not "moving fast", and nobody wants to say it in standup.',
    round: 1,
    at: Date.now() - 1000 * 60 * 60 * 20,
  },
  {
    id: '0',
    rating: 4,
    message: 'Good quarter overall. Docs improved a lot. Onboarding took me two days instead of two weeks.',
    round: 1,
    at: Date.now() - 1000 * 60 * 60 * 30,
  },
];

const load = async (): Promise<StoredState> => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as StoredState;
    } catch {
      // fall through and re-seed
    }
  }
  // The first visitor deploys the board, so they are its organizer — exactly
  // what the Compact constructor does with the deployer's witness.
  const organizer = await publicKey(getSecretKey(), 'organizer');
  const fresh: StoredState = {
    roundState: RoundState.open,
    round: 1,
    entryCount: 3,
    submitted: [],
    organizer,
    entries: seedEntries,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
};

const save = (state: StoredState): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const resetBoard = (): void => {
  localStorage.removeItem(STORAGE_KEY);
};

export const readState = async (): Promise<BoardState> => {
  const stored = await load();
  const sk = getSecretKey();
  const myNullifier = await nullifierFor(sk, stored.round);
  const myOrganizerKey = await publicKey(sk, 'organizer');

  const currentRound = stored.entries.filter((e) => e.round === stored.round);
  const averageRating =
    currentRound.length > 0 ? currentRound.reduce((s, e) => s + e.rating, 0) / currentRound.length : undefined;

  return {
    roundState: stored.roundState,
    round: stored.round,
    entryCount: stored.entryCount,
    entries: [...stored.entries].sort((a, b) => Number(b.id) - Number(a.id)),
    averageRating,
    isOrganizer: stored.organizer === myOrganizerKey,
    hasSubmitted: stored.submitted.includes(myNullifier),
  };
};

/** Mirrors `circuit submitFeedback`. */
export const submitFeedback = async (rating: number, message: string): Promise<void> => {
  const stored = await load();

  if (stored.roundState !== RoundState.open) {
    throw new Error('Feedback round is closed');
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }
  const text = message.trim();
  if (text.length === 0) throw new Error('Feedback message cannot be empty');

  const nullifier = await nullifierFor(getSecretKey(), stored.round);
  if (stored.submitted.includes(nullifier)) {
    throw new Error('This key has already submitted feedback in the current round');
  }

  stored.submitted.push(nullifier);
  stored.entries.push({
    id: String(stored.entryCount),
    rating,
    message: text,
    round: stored.round,
    at: Date.now(),
  });
  stored.entryCount += 1;
  save(stored);
};

/** Mirrors `circuit closeRound`. */
export const closeRound = async (): Promise<void> => {
  const stored = await load();
  if (stored.roundState !== RoundState.open) throw new Error('Round is already closed');
  if (stored.organizer !== (await publicKey(getSecretKey(), 'organizer'))) {
    throw new Error('Only the organizer may close the round');
  }
  stored.roundState = RoundState.closed;
  save(stored);
};

/** Mirrors `circuit openRound`. */
export const openRound = async (): Promise<void> => {
  const stored = await load();
  if (stored.roundState !== RoundState.closed) throw new Error('Round is already open');
  if (stored.organizer !== (await publicKey(getSecretKey(), 'organizer'))) {
    throw new Error('Only the organizer may open a new round');
  }
  stored.submitted = [];
  stored.round += 1;
  stored.roundState = RoundState.open;
  save(stored);
};
