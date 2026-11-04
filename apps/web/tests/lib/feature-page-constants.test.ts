import { describe, expect, it } from "vitest";
import { TIMEZONES } from "@/lib/timezones";
import { STATUS_FILTERS, type StatusFilter } from "@/lib/suggestion-filters";
import { filterTextChannels } from "@/lib/feature-list";
import type { DiscordChannel } from "@/lib/guild-settings";

// Audit D4 (rest) and D14: constants and the channel filter the feature pages now share, pinned to
// the literals the pages held at git HEAD d09dc0c.

describe("TIMEZONES", () => {
  it("equals the schedules page's TIMEZONES and the settings page's written-out list, in order", () => {
    // schedules/page.tsx lines 28-39 at HEAD
    const schedulesPage = [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
      "Europe/London",
      "Europe/Paris",
      "Asia/Tokyo",
      "UTC",
    ];
    // [guildId]/page.tsx line 890 at HEAD (the birthday timezone select)
    const settingsPage = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Paris", "Asia/Tokyo", "UTC"];
    expect([...TIMEZONES]).toEqual(schedulesPage);
    expect([...TIMEZONES]).toEqual(settingsPage);
  });
});

describe("STATUS_FILTERS", () => {
  it("equals the suggestions page's written-out tab list at HEAD, in order", () => {
    expect([...STATUS_FILTERS]).toEqual(["all", "pending", "approved", "rejected", "completed", "archived"]);
  });

  it("StatusFilter accepts exactly the old union's members", () => {
    const all: StatusFilter[] = ["all", "pending", "approved", "rejected", "completed", "archived"];
    expect(all).toHaveLength(6);
  });
});

describe("filterTextChannels", () => {
  it("keeps text and announcement channels in order, as the pages' own filter did", () => {
    const channels: DiscordChannel[] = [
      { id: "1", name: "general", type: "text" },
      { id: "2", name: "Voice", type: "voice" },
      { id: "3", name: "news", type: "announcement" },
      { id: "4", name: "Cat", type: "category" },
      { id: "5", name: "forum", type: "forum" },
      { id: "6", name: "stage", type: "stage" },
      { id: "7", name: "TEXT", type: "Text" },
      { id: "8", name: "rules", type: "text" },
    ];
    const original = channels.filter((c) => c.type === "text" || c.type === "announcement");
    expect(filterTextChannels(channels)).toEqual(original);
    expect(filterTextChannels(channels).map((c) => c.id)).toEqual(["1", "3", "8"]);
    expect(filterTextChannels([])).toEqual([]);
  });
});
