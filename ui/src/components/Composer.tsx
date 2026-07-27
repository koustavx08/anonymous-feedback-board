import { useState } from 'react';

type Props = {
  disabled: boolean;
  hasSubmitted: boolean;
  roundOpen: boolean;
  maxLength: number;
  onSubmit: (rating: number, message: string) => void;
};

const RATING_LABELS = ['Poor', 'Fair', 'Okay', 'Good', 'Great'];

export function Composer({ disabled, hasSubmitted, roundOpen, maxLength, onSubmit }: Props) {
  const [rating, setRating] = useState(4);
  const [message, setMessage] = useState('');

  const remaining = maxLength - message.length;
  const canSend = !disabled && message.trim().length > 0 && remaining >= 0;

  const notice = hasSubmitted
    ? 'You have already submitted in this round. Your nullifier is spent — the board can tell that, but not who you are.'
    : !roundOpen
      ? 'This round is closed. The organizer can open a new one.'
      : undefined;

  return (
    <section className="card composer">
      <h2>Leave feedback</h2>

      {notice && <p className="composer__notice">{notice}</p>}

      <div className="composer__rating" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} of 5 — ${RATING_LABELS[value - 1]}`}
            className={`star${value <= rating ? ' star--on' : ''}`}
            onClick={() => setRating(value)}
            disabled={disabled}
          >
            ★
          </button>
        ))}
        <span className="composer__rating-label">{RATING_LABELS[rating - 1]}</span>
      </div>

      <textarea
        className="composer__input"
        placeholder="What is actually working, and what isn't? No one will know it was you."
        value={message}
        maxLength={maxLength}
        rows={4}
        disabled={disabled}
        onChange={(event) => setMessage(event.target.value)}
      />

      <div className="composer__footer">
        <span className={`composer__count${remaining < 20 ? ' composer__count--low' : ''}`}>
          {remaining} characters left
        </span>
        <button
          className="btn btn--primary"
          disabled={!canSend}
          onClick={() => {
            onSubmit(rating, message);
            setMessage('');
          }}
        >
          Submit anonymously
        </button>
      </div>
    </section>
  );
}
