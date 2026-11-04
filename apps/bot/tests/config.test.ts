import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

const validEnv = {
  DISCORD_API_TOKEN: "token",
  BOT_CLIENT_ID: "123",
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  RESEND_API_KEY: "re_test",
  RESEND_FROM_EMAIL: "noreply@example.com",
  OPENAI_API_KEY: "sk-test",
  WEBAPP_URL: "https://app.example.com",
};

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = process.env;
  process.env = { ...validEnv };
});

afterEach(() => {
  process.env = savedEnv;
  vi.restoreAllMocks();
});

describe("loadConfig", () => {
  it("starts without JWT_SECRET, which only the web app uses", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const config = loadConfig();
    expect(exit).not.toHaveBeenCalled();
    expect(config).not.toHaveProperty("JWT_SECRET");
    expect(config.BOT_WEBHOOK_PORT).toBe(3001);
  });

  it("still exits when a required variable is missing", () => {
    delete process.env.DATABASE_URL;
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => loadConfig()).toThrow("process.exit called");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls[0]![0]).toContain("DATABASE_URL");
  });
});
