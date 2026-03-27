export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="max-w-lg text-center px-6">
        <div className="w-20 h-20 rounded-2xl bg-dc-accent flex items-center justify-center mx-auto mb-6">
          <span className="text-4xl">🐉</span>
        </div>
        <h1 className="text-4xl font-bold mb-3 text-dc-text-primary">DragonBot</h1>
        <p className="text-lg text-dc-text-secondary mb-8">
          A multi-guild Discord bot for university communities.
        </p>
        <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-6">
          <p className="text-dc-text-muted">
            Use the <code className="bg-dc-bg-tertiary px-2 py-0.5 rounded text-dc-accent text-sm">/login</code> command in Discord to access the dashboard.
          </p>
        </div>
      </div>
    </main>
  );
}
