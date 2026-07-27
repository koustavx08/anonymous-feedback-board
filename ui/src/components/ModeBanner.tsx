import type { BoardMode } from '../board/types';

type Props = {
  mode: BoardMode;
  reason?: string;
  contractAddress?: string;
  networkId: string;
};

/**
 * Tells the visitor, without hedging, whether they are looking at a real
 * on-chain board or the contract's rules running locally.
 */
export function ModeBanner({ mode, reason, contractAddress, networkId }: Props) {
  if (mode === 'chain' && contractAddress) {
    return (
      <div className="banner banner--chain">
        <span className="banner__badge">On-chain</span>
        <span>
          Connected to <code>{contractAddress}</code> on <strong>{networkId}</strong>. Every action below is a
          real transaction, proved locally before it is submitted.
        </span>
      </div>
    );
  }

  return (
    <div className="banner banner--local">
      <span className="banner__badge">Local mode</span>
      <span>
        No zero-knowledge proofs are being generated here. This page is running the exact rules from{' '}
        <code>feedback.compact</code> against your browser’s storage, so the flow is explorable without a wallet,
        a proof server and a funded account. {reason}
      </span>
    </div>
  );
}
