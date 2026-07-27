/** Types shared across the UI. Mirrors `@feedback/api`'s derived state. */

export enum RoundState {
  open = 0,
  closed = 1,
}

export type FeedbackEntry = {
  readonly id: string;
  readonly rating: number;
  readonly message: string;
  readonly round: number;
  /** Millisecond timestamp. Local display only — the ledger stores no clock. */
  readonly at: number;
};

export type BoardState = {
  readonly roundState: RoundState;
  readonly round: number;
  readonly entryCount: number;
  readonly entries: readonly FeedbackEntry[];
  readonly averageRating: number | undefined;
  readonly isOrganizer: boolean;
  readonly hasSubmitted: boolean;
};

/**
 * How the UI is currently talking to the board.
 *
 * - `chain`    — a real deployed contract, via wallet + local proof server.
 * - `local`    — the contract's rules enforced in-browser, no chain involved.
 */
export type BoardMode = 'chain' | 'local';

export type WalletInfo = {
  readonly name: string;
  readonly apiVersion: string;
  readonly address: string;
};

export interface BoardClient {
  readonly mode: BoardMode;
  readonly contractAddress: string | undefined;
  getState(): Promise<BoardState>;
  subscribe(listener: (state: BoardState) => void): () => void;
  submitFeedback(rating: number, message: string): Promise<void>;
  closeRound(): Promise<void>;
  openRound(): Promise<void>;
}

export const MAX_MESSAGE_LENGTH = 280;
