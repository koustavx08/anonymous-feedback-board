/**
 * Chooses how the UI talks to the feedback board and presents one interface
 * to the React layer.
 *
 * Real on-chain mode needs three things that only exist on a developer's own
 * machine: a wallet extension, a proof server on localhost, and a compiled
 * contract with its ZK keys. When all three are present we drive the deployed
 * contract through `@feedback/api`. Otherwise we run the same rules locally so
 * the app is still usable and reviewable.
 */

import * as engine from './engine';
import type { BoardClient, BoardMode, BoardState } from './types';

export const CONTRACT_ADDRESS_PLACEHOLDER = '<YOUR_DEPLOYED_CONTRACT_ADDRESS>';

export const configuredContractAddress = (): string | undefined => {
  const value = import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined;
  if (!value || value.startsWith('<')) return undefined;
  return value;
};

export const configuredNetworkId = (): string =>
  (import.meta.env.VITE_NETWORK_ID as string | undefined) ?? 'preprod';

export const configuredProofServer = (): string =>
  (import.meta.env.VITE_PROOF_SERVER_URL as string | undefined) ?? 'http://127.0.0.1:6300';

/** Simple observer plumbing shared by both implementations. */
class Emitter {
  #listeners = new Set<(state: BoardState) => void>();

  subscribe(listener: (state: BoardState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(state: BoardState): void {
    for (const listener of this.#listeners) listener(state);
  }
}

/** Board backed by the in-browser rule engine. */
class LocalBoardClient implements BoardClient {
  readonly mode: BoardMode = 'local';
  readonly contractAddress = undefined;
  #emitter = new Emitter();

  getState(): Promise<BoardState> {
    return engine.readState();
  }

  subscribe(listener: (state: BoardState) => void): () => void {
    return this.#emitter.subscribe(listener);
  }

  async #refresh(): Promise<void> {
    this.#emitter.emit(await engine.readState());
  }

  async submitFeedback(rating: number, message: string): Promise<void> {
    await engine.submitFeedback(rating, message);
    await this.#refresh();
  }

  async closeRound(): Promise<void> {
    await engine.closeRound();
    await this.#refresh();
  }

  async openRound(): Promise<void> {
    await engine.openRound();
    await this.#refresh();
  }
}

/** The slice of `@feedback/api` this module actually uses. */
type LiveFeedbackApi = {
  state$: { subscribe(fn: (s: unknown) => void): { unsubscribe(): void } };
  submitFeedback(rating: number, message: string): Promise<void>;
  closeRound(): Promise<void>;
  openRound(): Promise<void>;
};

type FeedbackApiModule = {
  buildBrowserProviders(options: { networkId: string; proofServer: string }): Promise<unknown>;
  FeedbackBoardAPI: {
    join(providers: unknown, contractAddress: string): Promise<LiveFeedbackApi>;
  };
};

/**
 * Board backed by a deployed Compact contract.
 *
 * `@feedback/api` and the Midnight SDK are imported dynamically: they pull in
 * WebAssembly proving machinery that has no business loading for a visitor who
 * is only reading the page.
 */
class ChainBoardClient implements BoardClient {
  readonly mode: BoardMode = 'chain';
  #emitter = new Emitter();
  #latest: BoardState | undefined;

  private constructor(
    readonly contractAddress: string,
    private readonly api: LiveFeedbackApi,
  ) {
    this.api.state$.subscribe((state) => {
      this.#latest = state as BoardState;
      this.#emitter.emit(this.#latest);
    });
  }

  static async connect(contractAddress: string): Promise<ChainBoardClient> {
    // Resolved at runtime; absent from the static web bundle by design, so it
    // is typed structurally rather than via `typeof import(...)`.
    const moduleId = '@feedback/api';
    const mod = (await import(/* @vite-ignore */ moduleId)) as FeedbackApiModule;

    const providers = await mod.buildBrowserProviders({
      networkId: configuredNetworkId(),
      proofServer: configuredProofServer(),
    });
    const api = await mod.FeedbackBoardAPI.join(providers, contractAddress);
    return new ChainBoardClient(contractAddress, api);
  }

  async getState(): Promise<BoardState> {
    if (this.#latest) return this.#latest;
    return new Promise((resolve) => {
      const unsubscribe = this.#emitter.subscribe((state) => {
        unsubscribe();
        resolve(state);
      });
    });
  }

  subscribe(listener: (state: BoardState) => void): () => void {
    return this.#emitter.subscribe(listener);
  }

  submitFeedback(rating: number, message: string): Promise<void> {
    return this.api.submitFeedback(rating, message);
  }

  closeRound(): Promise<void> {
    return this.api.closeRound();
  }

  openRound(): Promise<void> {
    return this.api.openRound();
  }
}

export type ClientResolution = {
  readonly client: BoardClient;
  /** Why we fell back, when we did. Surfaced in the UI rather than swallowed. */
  readonly reason?: string;
};

/**
 * Try the chain, fall back to local. Never throws — a failure to reach the
 * chain should degrade the page, not break it.
 */
export const createBoardClient = async (): Promise<ClientResolution> => {
  const address = configuredContractAddress();
  if (!address) {
    return {
      client: new LocalBoardClient(),
      reason: 'No contract address configured — set VITE_CONTRACT_ADDRESS after deploying.',
    };
  }

  try {
    const client = await ChainBoardClient.connect(address);
    return { client };
  } catch (error) {
    return {
      client: new LocalBoardClient(),
      reason: `Could not reach the deployed contract (${
        error instanceof Error ? error.message : String(error)
      }). Running the contract's rules locally instead.`,
    };
  }
};
