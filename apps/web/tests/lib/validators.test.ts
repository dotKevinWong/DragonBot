import { describe, expect, it } from "vitest";
import { DISCORD_SNOWFLAKE_RE } from "@/lib/validators";

describe("DISCORD_SNOWFLAKE_RE", () => {
  it("accepts a 17-20 digit snowflake and rejects other input", () => {
    expect(DISCORD_SNOWFLAKE_RE.test("123456789012345678")).toBe(true);
    expect(DISCORD_SNOWFLAKE_RE.test("abc")).toBe(false);
  });
});
