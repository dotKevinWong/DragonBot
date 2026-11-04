import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBotClient } from "@dragonbot/db";
import { createServerlessClient } from "@dragonbot/db/serverless";

// Characterization of the Drizzle query logger that both DB clients install (D10).
// Neither client connects until a query runs, so no database is touched here:
// the test reads the logger off the Drizzle session and calls it directly.

const URL = "postgres://user:pass@127.0.0.1:1/none";

type LoggerHolder = { session: { logger: { logQuery(query: string, params: unknown[]): void } } };

const clients: [string, () => unknown][] = [
  ["createBotClient (postgres-js)", () => createBotClient(URL)],
  ["createServerlessClient (neon-http)", () => createServerlessClient(URL)],
];

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T12:34:56.789Z"));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  vi.useRealTimers();
});

function logLine(make: () => unknown, query: string): string {
  const db = make() as LoggerHolder;
  logSpy.mockClear();
  db.session.logger.logQuery(query, []);
  expect(logSpy).toHaveBeenCalledTimes(1);
  return logSpy.mock.calls[0]![0] as string;
}

for (const [name, make] of clients) {
  describe(`${name} query logger`, () => {
    it("writes one JSON line with the fixed key order", () => {
      expect(logLine(make, "select * from users")).toBe(
        '{"level":"info","msg":"DB query executed","source":"neon","timestamp":"2026-11-03T12:34:56.789Z","command":"SELECT","query":"select * from users"}',
      );
    });

    it("keeps a 200-character query whole", () => {
      const q = "a".repeat(200);
      expect(JSON.parse(logLine(make, q)).query).toBe(q);
    });

    it("cuts a 201-character query to 200 characters plus U+2026", () => {
      const q = "b".repeat(201);
      const out = JSON.parse(logLine(make, q)).query as string;
      expect(out).toBe(`${"b".repeat(200)}…`);
      expect(out.length).toBe(201);
    });

    it("reports an empty command for an empty or whitespace-led query", () => {
      expect(JSON.parse(logLine(make, "")).command).toBe("");
      expect(JSON.parse(logLine(make, "  update x")).command).toBe("");
    });

    it("upper-cases the first word only", () => {
      expect(JSON.parse(logLine(make, "insert into t values (1)")).command).toBe("INSERT");
    });

    it("ignores the params argument", () => {
      const db = make() as LoggerHolder;
      logSpy.mockClear();
      db.session.logger.logQuery("select 1", ["secret"]);
      expect(logSpy.mock.calls[0]![0]).not.toContain("secret");
    });
  });
}
