/**
 * Contract-interaction layer for the Anonymous Feedback Board.
 *
 * Wraps a deployed Compact contract in a small, UI-friendly API and exposes the
 * combined public + private state as an RxJS observable.
 *
 * @packageDocumentation
 */

import * as Feedback from '@feedback/contract';
import { CompiledFeedbackBoardContract, createFeedbackPrivateState, type FeedbackPrivateState } from '@feedback/contract';

import { type ContractAddress, convertFieldToBytes } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { combineLatest, from, map, tap, type Observable } from 'rxjs';
import { type Logger } from 'pino';

import {
  feedbackPrivateStateKey,
  type DeployedFeedbackContract,
  type FeedbackContract,
  type FeedbackDerivedState,
  type FeedbackEntry,
  type FeedbackProviders,
} from './common-types.js';
import { assertValidMessage, assertValidRating, randomBytes } from './utils.js';

/** Domain separator used by the `organizer` commitment in feedback.compact. */
const ORGANIZER_DOMAIN = new TextEncoder().encode('organizer');

const padTo32 = (bytes: Uint8Array): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(bytes.subarray(0, 32));
  return out;
};

/** Public surface of a live feedback board. */
export interface DeployedFeedbackAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<FeedbackDerivedState>;

  submitFeedback: (rating: number, message: string) => Promise<void>;
  closeRound: () => Promise<void>;
  openRound: () => Promise<void>;
}

export class FeedbackBoardAPI implements DeployedFeedbackAPI {
  private constructor(
    public readonly deployedContract: DeployedFeedbackContract,
    providers: FeedbackProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);

    this.state$ = combineLatest(
      [
        // Public ledger state, streamed from the indexer.
        providers.publicDataProvider
          .contractStateObservable(this.deployedContractAddress, { type: 'latest' })
          .pipe(
            map((contractState) => Feedback.ledger(contractState.data)),
            tap((ledgerState) =>
              logger?.trace({
                ledgerStateChanged: {
                  round: ledgerState.round,
                  entryCount: ledgerState.entryCount,
                  roundState: ledgerState.roundState,
                },
              }),
            ),
          ),
        // Private state. Constant for the lifetime of the session, so a single
        // read is enough — we only need it to answer "is this me?" questions.
        from(providers.privateStateProvider.get(feedbackPrivateStateKey) as Promise<FeedbackPrivateState>),
      ],
      (ledgerState, privateState): FeedbackDerivedState => {
        // Re-derive our own commitments locally. These never leave this machine;
        // we compare them against the public values to learn what we may do.
        const organizerKey = Feedback.pureCircuits.publicKey(
          privateState.secretKey,
          padTo32(ORGANIZER_DOMAIN),
        );
        const myNullifier = Feedback.pureCircuits.nullifier(
          privateState.secretKey,
          convertFieldToBytes(32, ledgerState.round, 'api/src/index.ts'),
        );

        const entries: FeedbackEntry[] = [];
        for (const [id, rating] of ledgerState.ratings) {
          entries.push({
            id,
            rating: Number(rating),
            message: ledgerState.messages.lookup(id),
            round: ledgerState.entryRound.lookup(id),
          });
        }
        entries.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

        const currentRoundEntries = entries.filter((e) => e.round === ledgerState.round);
        const averageRating =
          currentRoundEntries.length > 0
            ? currentRoundEntries.reduce((sum, e) => sum + e.rating, 0) / currentRoundEntries.length
            : undefined;

        return {
          roundState: ledgerState.roundState,
          round: ledgerState.round,
          entryCount: ledgerState.entryCount,
          entries,
          averageRating,
          isOrganizer: toHex(ledgerState.organizer) === toHex(organizerKey),
          hasSubmitted: ledgerState.submitted.member(myNullifier),
        };
      },
    );
  }

  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<FeedbackDerivedState>;

  /**
   * Submit one piece of feedback to the open round.
   *
   * Fails during local circuit execution — before anything is sent to the
   * network — if the round is closed or this key has already been used.
   */
  async submitFeedback(rating: number, message: string): Promise<void> {
    const validRating = assertValidRating(rating);
    const validMessage = assertValidMessage(message);

    this.logger?.info({ submitFeedback: { rating: validRating } });

    const txData = await this.deployedContract.callTx.submitFeedback(validRating, validMessage);

    this.logger?.trace({
      transactionAdded: {
        circuit: 'submitFeedback',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /** Close the round. Only succeeds for the organizer. */
  async closeRound(): Promise<void> {
    this.logger?.info('closeRound');
    const txData = await this.deployedContract.callTx.closeRound();
    this.logger?.trace({
      transactionAdded: { circuit: 'closeRound', txHash: txData.public.txHash },
    });
  }

  /** Start a fresh round, retiring every nullifier. Only succeeds for the organizer. */
  async openRound(): Promise<void> {
    this.logger?.info('openRound');
    const txData = await this.deployedContract.callTx.openRound();
    this.logger?.trace({
      transactionAdded: { circuit: 'openRound', txHash: txData.public.txHash },
    });
  }

  /** Deploy a brand-new feedback board. The deployer becomes the organizer. */
  static async deploy(providers: FeedbackProviders, logger?: Logger): Promise<FeedbackBoardAPI> {
    logger?.info('deployContract');

    const deployed = await deployContract(providers, {
      compiledContract: CompiledFeedbackBoardContract,
      privateStateId: feedbackPrivateStateKey,
      initialPrivateState: createFeedbackPrivateState(randomBytes(32)),
    });

    logger?.trace({ contractDeployed: { finalizedDeployTxData: deployed.deployTxData.public } });

    return new FeedbackBoardAPI(deployed, providers, logger);
  }

  /** Join a board that is already on the network. */
  static async join(
    providers: FeedbackProviders,
    contractAddress: ContractAddress,
    logger?: Logger,
  ): Promise<FeedbackBoardAPI> {
    logger?.info({ joinContract: { contractAddress } });

    const deployed = await findDeployedContract<FeedbackContract>(providers, {
      contractAddress,
      compiledContract: CompiledFeedbackBoardContract,
      privateStateId: feedbackPrivateStateKey,
      initialPrivateState: await FeedbackBoardAPI.getPrivateState(providers, contractAddress),
    });

    logger?.trace({ contractJoined: { finalizedDeployTxData: deployed.deployTxData.public } });

    return new FeedbackBoardAPI(deployed, providers, logger);
  }

  private static async getPrivateState(
    providers: FeedbackProviders,
    contractAddress: ContractAddress,
  ): Promise<FeedbackPrivateState> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = await providers.privateStateProvider.get(feedbackPrivateStateKey);
    return existing ?? createFeedbackPrivateState(randomBytes(32));
  }
}

export * from './browser-providers.js';
export * from './common-types.js';
export * from './config.js';
export * as utils from './utils.js';
