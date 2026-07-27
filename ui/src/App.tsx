import { useCallback, useEffect, useMemo, useState } from 'react';

import { createBoardClient, configuredContractAddress, configuredNetworkId } from './board/client';
import { rotateSecretKey, resetBoard } from './board/engine';
import { connectWallet, detectWallet, WalletNotFoundError } from './board/wallet';
import { MAX_MESSAGE_LENGTH, RoundState, type BoardClient, type BoardState, type WalletInfo } from './board/types';

import { Composer } from './components/Composer';
import { EntryList } from './components/EntryList';
import { ModeBanner } from './components/ModeBanner';
import { OrganizerPanel } from './components/OrganizerPanel';
import { StatCard } from './components/StatCard';

type Status = { kind: 'idle' } | { kind: 'busy'; label: string } | { kind: 'error'; message: string };

export default function App() {
  const [client, setClient] = useState<BoardClient | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | undefined>();
  const [state, setState] = useState<BoardState | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [wallet, setWallet] = useState<WalletInfo | null>(null);

  const contractAddress = configuredContractAddress();
  const networkId = configuredNetworkId();
  const walletAvailable = useMemo(() => detectWallet().status === 'available', []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { client: resolved, reason } = await createBoardClient();
      if (cancelled) return;
      setClient(resolved);
      setFallbackReason(reason);
      setState(await resolved.getState());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!client) return;
    return client.subscribe(setState);
  }, [client]);

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setStatus({ kind: 'busy', label });
      try {
        await action();
        if (client) setState(await client.getState());
        setStatus({ kind: 'idle' });
      } catch (error) {
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [client],
  );

  const handleSubmit = useCallback(
    (rating: number, message: string) =>
      run('Proving your submission is unique…', async () => {
        if (!client) throw new Error('Board is still loading');
        await client.submitFeedback(rating, message);
      }),
    [client, run],
  );

  const handleConnectWallet = useCallback(async () => {
    setStatus({ kind: 'busy', label: 'Waiting for wallet authorization…' });
    try {
      const { info } = await connectWallet(networkId);
      setWallet(info);
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof WalletNotFoundError
            ? error.message
            : `Wallet connection failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [networkId]);

  const handleNewIdentity = useCallback(() => {
    rotateSecretKey();
    window.location.reload();
  }, []);

  const handleResetBoard = useCallback(() => {
    resetBoard();
    window.location.reload();
  }, []);

  const isOpen = state?.roundState === RoundState.open;

  return (
    <div className="app">
      <header className="header">
        <div className="header__brand">
          <span className="header__mark" aria-hidden="true" />
          <div>
            <h1>Anonymous Feedback Board</h1>
            <p className="header__tagline">
              Say what you actually think. The board learns your feedback — never your name.
            </p>
          </div>
        </div>

        <div className="header__wallet">
          {wallet ? (
            <div className="wallet-chip" title={wallet.address}>
              <span className="wallet-chip__dot" />
              <span className="wallet-chip__name">{wallet.name}</span>
              <code className="wallet-chip__addr">
                {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
              </code>
            </div>
          ) : (
            <button className="btn btn--ghost" onClick={handleConnectWallet} disabled={status.kind === 'busy'}>
              {walletAvailable ? 'Connect wallet' : 'No wallet detected'}
            </button>
          )}
        </div>
      </header>

      <ModeBanner
        mode={client?.mode ?? 'local'}
        reason={fallbackReason}
        contractAddress={contractAddress}
        networkId={networkId}
      />

      {status.kind === 'error' && (
        <div className="alert alert--error" role="alert">
          <strong>Rejected.</strong> {status.message}
          <button className="alert__dismiss" onClick={() => setStatus({ kind: 'idle' })} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {status.kind === 'busy' && (
        <div className="alert alert--busy" role="status">
          <span className="spinner" aria-hidden="true" />
          {status.label}
        </div>
      )}

      {!state ? (
        <div className="loading">Loading board…</div>
      ) : (
        <>
          <section className="stats" aria-label="Board statistics">
            <StatCard
              label="Round"
              value={`#${state.round}`}
              hint={isOpen ? 'Accepting feedback' : 'Closed'}
              tone={isOpen ? 'good' : 'muted'}
            />
            <StatCard label="Entries" value={String(state.entryCount)} hint="Public on the ledger" />
            <StatCard
              label="Average rating"
              value={state.averageRating ? `${state.averageRating.toFixed(1)} ★` : '—'}
              hint="This round"
            />
            <StatCard
              label="Your status"
              value={state.hasSubmitted ? 'Submitted' : isOpen ? 'Eligible' : 'Locked'}
              hint={state.hasSubmitted ? 'Nullifier spent' : 'One per round'}
              tone={state.hasSubmitted ? 'muted' : isOpen ? 'good' : 'muted'}
            />
          </section>

          <main className="layout">
            <div className="layout__main">
              <Composer
                disabled={!isOpen || state.hasSubmitted || status.kind === 'busy'}
                hasSubmitted={state.hasSubmitted}
                roundOpen={isOpen}
                maxLength={MAX_MESSAGE_LENGTH}
                onSubmit={handleSubmit}
              />
              <EntryList entries={state.entries} currentRound={state.round} />
            </div>

            <aside className="layout__side">
              <section className="card card--privacy">
                <h2>What the chain sees</h2>
                <ul className="privacy-list">
                  <li>
                    <span className="privacy-list__tag privacy-list__tag--public">public</span>
                    Your rating and your words
                  </li>
                  <li>
                    <span className="privacy-list__tag privacy-list__tag--public">public</span>
                    A one-way nullifier per submission
                  </li>
                  <li>
                    <span className="privacy-list__tag privacy-list__tag--private">private</span>
                    Your secret key — it never leaves this device
                  </li>
                  <li>
                    <span className="privacy-list__tag privacy-list__tag--private">private</span>
                    Any link between you and your feedback
                  </li>
                </ul>
                <p className="privacy-note">
                  You prove <em>“I hold a key that hasn’t been used this round”</em> without revealing the key.
                  That is what stops ballot-stuffing without a login.
                </p>
                <button className="btn btn--subtle" onClick={handleNewIdentity}>
                  Rotate my key
                </button>
              </section>

              {state.isOrganizer && (
                <OrganizerPanel
                  roundOpen={isOpen}
                  busy={status.kind === 'busy'}
                  onClose={() => run('Closing the round…', () => client!.closeRound())}
                  onOpen={() => run('Opening a new round…', () => client!.openRound())}
                />
              )}

              {client?.mode === 'local' && (
                <section className="card card--reset">
                  <h2>Demo controls</h2>
                  <p>Clear the locally stored board and start over.</p>
                  <button className="btn btn--subtle" onClick={handleResetBoard}>
                    Reset board
                  </button>
                </section>
              )}
            </aside>
          </main>
        </>
      )}

      <footer className="footer">
        <span>
          Built on <a href="https://midnight.network">Midnight</a> · Compact contract{' '}
          <code>contract/src/feedback.compact</code>
        </span>
      </footer>
    </div>
  );
}
