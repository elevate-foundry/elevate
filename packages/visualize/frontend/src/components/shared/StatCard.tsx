export function StatCard({ label, value, id }: { label: string; value: string | number; id?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" id={id}>{value}</div>
    </div>
  );
}
