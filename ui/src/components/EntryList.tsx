import type { FeedbackEntry } from '../board/types';

type Props = {
  entries: readonly FeedbackEntry[];
  currentRound: number;
};

const relativeTime = (timestamp: number): string => {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export function EntryList({ entries, currentRound }: Props) {
  if (entries.length === 0) {
    return (
      <section className="card">
        <h2>Feedback</h2>
        <p className="empty">Nothing yet. Be the first — no one will know it was you.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>
        Feedback <span className="count-pill">{entries.length}</span>
      </h2>
      <ul className="entries">
        {entries.map((entry) => (
          <li key={entry.id} className="entry">
            <div className="entry__head">
              <span className="entry__stars" aria-label={`${entry.rating} out of 5`}>
                {'★'.repeat(entry.rating)}
                <span className="entry__stars-off">{'★'.repeat(5 - entry.rating)}</span>
              </span>
              <span className="entry__meta">
                <span className="entry__author">anonymous</span>
                {entry.round !== currentRound && <span className="entry__round">round #{entry.round}</span>}
                <span>{relativeTime(entry.at)}</span>
              </span>
            </div>
            <p className="entry__body">{entry.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
