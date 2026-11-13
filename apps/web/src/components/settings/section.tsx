/** A card of related settings, like the grouped blocks in Discord's server settings. */
export function Section({ title, description, children }: {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-dc-bg-secondary border border-dc-border rounded-xl p-5 mb-4">
      {title && <h3 className="text-base font-semibold text-dc-text-primary">{title}</h3>}
      {description && <p className="text-sm text-dc-text-muted mt-1">{description}</p>}
      <div className={`space-y-5 ${title || description ? "mt-5" : ""}`}>{children}</div>
    </section>
  );
}

/** A thin rule between groups inside a Section. */
export function Divider() {
  return <hr className="border-0 border-t border-dc-border" />;
}
