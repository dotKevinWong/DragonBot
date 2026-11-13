import { describe, expect, it } from "vitest";
import { LOG_EVENTS } from "@dragonbot/db/contracts";

// Pins the constants the server settings page now shares (audit D4 page part). The form class strings
// were pinned here too until the November 2026 Discord restyle changed them on purpose.

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

