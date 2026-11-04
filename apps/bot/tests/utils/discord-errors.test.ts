import { describe, it, expect } from "vitest";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import { describeError, hasErrorCode } from "../../src/utils/discord-errors.js";

function apiError(code: number | string, message: string) {
  return new DiscordAPIError({ code: code as number, message }, code as number, 404, "GET", "/x", {});
}

describe("hasErrorCode", () => {
  it("matches a Discord API error with one of the codes", () => {
    const err = apiError(RESTJSONErrorCodes.UnknownMessage, "Unknown Message");
    expect(hasErrorCode(err, RESTJSONErrorCodes.UnknownMessage)).toBe(true);
    expect(hasErrorCode(err, RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.UnknownMessage)).toBe(true);
    expect(hasErrorCode(err, RESTJSONErrorCodes.UnknownChannel)).toBe(false);
    expect(hasErrorCode(err)).toBe(false);
  });

  it("doesn't match anything that isn't a Discord API error, or a string code", () => {
    const plain = Object.assign(new Error("Unknown Message"), { code: RESTJSONErrorCodes.UnknownMessage });
    expect(hasErrorCode(plain, RESTJSONErrorCodes.UnknownMessage)).toBe(false);
    expect(hasErrorCode({ code: RESTJSONErrorCodes.UnknownMessage }, RESTJSONErrorCodes.UnknownMessage)).toBe(false);
    expect(hasErrorCode(null, RESTJSONErrorCodes.UnknownMessage)).toBe(false);
    expect(hasErrorCode(apiError("10008", "Unknown Message"), RESTJSONErrorCodes.UnknownMessage)).toBe(false);
  });
});

describe("describeError", () => {
  it("uses an error's message, and the value as text otherwise, without shortening", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError(new Error(""))).toBe("Error");
    expect(describeError(new TypeError(""))).toBe("TypeError");
    expect(describeError("plain text")).toBe("plain text");
    expect(describeError({ a: 1 })).toBe("[object Object]");
    expect(describeError(null)).toBe("null");
    expect(describeError(undefined)).toBe("undefined");
    expect(describeError(new Error("x".repeat(500)))).toHaveLength(500);
  });
});
