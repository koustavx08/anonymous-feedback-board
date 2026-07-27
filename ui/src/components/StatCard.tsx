type Props = {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'muted';
};

export function StatCard({ label, value, hint, tone }: Props) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {hint && <span className="stat__hint">{hint}</span>}
    </div>
  );
}
