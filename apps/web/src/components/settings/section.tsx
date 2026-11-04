export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-5 mb-4">
      <h2 className="text-sm font-semibold text-dc-text-primary mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
