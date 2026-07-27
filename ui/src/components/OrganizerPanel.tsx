type Props = {
  roundOpen: boolean;
  busy: boolean;
  onClose: () => void;
  onOpen: () => void;
};

export function OrganizerPanel({ roundOpen, busy, onClose, onOpen }: Props) {
  return (
    <section className="card card--organizer">
      <h2>
        Organizer <span className="badge badge--organizer">you</span>
      </h2>
      <p>
        You hold the key behind this board’s organizer commitment. Opening a new round retires every nullifier,
        so everyone may submit once more — still only once.
      </p>
      {roundOpen ? (
        <button className="btn btn--danger" onClick={onClose} disabled={busy}>
          Close round
        </button>
      ) : (
        <button className="btn btn--primary" onClick={onOpen} disabled={busy}>
          Open new round
        </button>
      )}
    </section>
  );
}
