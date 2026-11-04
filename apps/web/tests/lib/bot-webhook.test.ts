import { beforeEach, describe, expect, it, vi } from "vitest";

// notifyBotReload (P16). The first block is characterization of the pre-P16
// call; the scope block is new with P16.

const envState = vi.hoisted(() => ({
  env: {} as { BOT_WEBHOOK_URL?: string; BOT_WEBHOOK_SECRET?: string },
}));
vi.mock("@/lib/env", () => ({
  env: new Proxy({}, { get: (_t, prop: string) => envState.env[prop as keyof typeof envState.env] }),
}));

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
vi.stubGlobal("fetch", fetchMock);

import { notifyBotReload } from "@/lib/bot-webhook";

const GUILD = "222222222222222222";

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
  envState.env = { BOT_WEBHOOK_URL: "http://bot.internal:3001", BOT_WEBHOOK_SECRET: "0123456789abcdef" };
});

describe("notifyBotReload (characterization)", () => {
  it("no-op when either env var is unset", () => {
    envState.env = { BOT_WEBHOOK_URL: "http://bot.internal:3001" };
    notifyBotReload(GUILD);
    envState.env = { BOT_WEBHOOK_SECRET: "0123456789abcdef" };
    notifyBotReload(GUILD);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the reload URL with the bearer secret and returns nothing", () => {
    expect(notifyBotReload(GUILD)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      `http://bot.internal:3001/webhook/reload?guildId=${GUILD}`,
      { method: "POST", headers: { Authorization: "Bearer 0123456789abcdef" } },
    ]);
  });

  it("encodes the guild id", () => {
    notifyBotReload("a&b c");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://bot.internal:3001/webhook/reload?guildId=a%26b%20c");
  });

  it("a rejected fetch is swallowed and logged", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });
    notifyBotReload(GUILD);
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledWith("[bot-webhook] Failed to notify bot reload:", "ECONNREFUSED");
    spy.mockRestore();
  });
});

describe("notifyBotReload scope hint (P16)", () => {
  it('scope "settings" appends &scope=settings; anything else is the unchanged URL', () => {
    notifyBotReload(GUILD, "settings");
    notifyBotReload(GUILD, undefined);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `http://bot.internal:3001/webhook/reload?guildId=${GUILD}&scope=settings`,
      `http://bot.internal:3001/webhook/reload?guildId=${GUILD}`,
    ]);
  });
});
