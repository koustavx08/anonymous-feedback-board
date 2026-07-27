/**
 * Shared types for the Anonymous Feedback Board API.
 *
 * @module
 */

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { Contract, Witnesses, FeedbackPrivateState, RoundState } from '@feedback/contract';

/** Key under which the board's private state is filed by the private-state provider. */
export const feedbackPrivateStateKey = 'feedbackPrivateState';
export type PrivateStateId = typeof feedbackPrivateStateKey;

/**
 * Schema of every private state used by this dApp. One contract type, so one key.
 */
export type PrivateStates = {
  readonly feedbackPrivateState: FeedbackPrivateState;
};

export type FeedbackContract = Contract<FeedbackPrivateState, Witnesses<FeedbackPrivateState>>;

/** Names of the circuits callable on a deployed board. */
export type FeedbackCircuitKeys = Exclude<keyof FeedbackContract['impureCircuits'], number | symbol>;

export type FeedbackProviders = MidnightProviders<FeedbackCircuitKeys, PrivateStateId, FeedbackPrivateState>;

export type DeployedFeedbackContract = FoundContract<FeedbackContract>;

/** One publicly-readable feedback entry. */
export type FeedbackEntry = {
  readonly id: bigint;
  /** 1..5 stars. Public. */
  readonly rating: number;
  /** The feedback text. Public. */
  readonly message: string;
  /** Which round this entry belongs to. Public. */
  readonly round: bigint;
};

/**
 * Public ledger state combined with what the local private state lets us infer.
 *
 * Note what is NOT here and cannot be: the identity of any author. The ledger
 * only stores nullifiers, and a nullifier is a one-way hash of a secret key we
 * never see for anyone but ourselves.
 */
export type FeedbackDerivedState = {
  readonly roundState: RoundState;
  readonly round: bigint;
  readonly entryCount: bigint;
  readonly entries: readonly FeedbackEntry[];
  /** Mean rating across entries in the current round, or `undefined` if none. */
  readonly averageRating: number | undefined;
  /** True when the local secret key matches the organizer commitment. */
  readonly isOrganizer: boolean;
  /** True when the local secret key has already been used this round. */
  readonly hasSubmitted: boolean;
};
