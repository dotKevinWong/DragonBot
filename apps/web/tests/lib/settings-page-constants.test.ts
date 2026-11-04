import { describe, expect, it } from "vitest";
import { LOG_EVENTS } from "@dragonbot/db/contracts";
import { FIELD_LABEL_CLASS, SELECT_CLASS, TEXT_INPUT_CLASS } from "@/lib/form-classes";

// Pins the constants the server settings page now shares (audit D4 page part, D16).

describe("settings page log event options", () => {
  it("LOG_EVENTS has the keys and order of the page's old LOG_EVENT_OPTIONS literal", () => {
    // The literal the page held at git HEAD d09dc0c; EventPicker renders one button per key, in order.
    const oldPageOptions = [
      "member_join", "member_leave", "message_delete", "message_edit",
      "role_change", "nickname_change", "voice_activity", "kick", "ban",
    ];
    expect([...LOG_EVENTS]).toEqual(oldPageOptions);
  });
});

describe("form class strings", () => {
  it("are byte-identical to the written-out strings they replaced", () => {
    expect(FIELD_LABEL_CLASS).toBe("block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5");
    expect(TEXT_INPUT_CLASS).toBe(
      "w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors",
    );
    expect(SELECT_CLASS).toBe(
      "w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors cursor-pointer",
    );
  });
});
