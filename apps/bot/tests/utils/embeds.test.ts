import { describe, it, expect } from "vitest";
import { successEmbed, errorEmbed, infoEmbed } from "../../src/utils/embeds.js";

describe("embeds", () => {
  it("keeps the colours and descriptions", () => {
    expect(successEmbed("ok").toJSON()).toEqual({ color: 0x43b581, description: "ok" });
    expect(errorEmbed("bad").toJSON()).toEqual({ color: 0xff0000, description: "bad" });
    expect(infoEmbed("fyi").toJSON()).toEqual({ color: 0xffcc00, description: "fyi" });
  });
});
