"use client";

import { useState } from "react";
import { REPEAT_SPAM_MIN_CHANNELS, REPEAT_SPAM_MAX_CHANNELS } from "@dragonbot/db/honeypot";
import { Toggle } from "../toggle";
import { Section, Divider } from "../section";
import { ChannelSelect } from "../channel-select";
import { EventPicker } from "../event-picker";
import { FIELD_HINT_CLASS, FIELD_LABEL_CLASS, SELECT_CLASS, TEXT_INPUT_CLASS } from "@/lib/form-classes";
import type { PanelProps } from "./types";

export function ModerationPanel({ settings, update, channels }: PanelProps) {
  return (
    <Section>
      <Toggle
        label="Cross-server ban sync"
        description="A ban here is copied to every other DragonBot server that also has ban sync on. Honeypot bans are never copied."
        checked={settings.isBanSyncEnabled}
        onChange={(v) => update("isBanSyncEnabled", v)}
      />
      <Divider />
      <ChannelSelect
        label="Mod notes channel"
        description="Where /suggest posts new suggestions for staff to vote on."
        value={settings.modNotesChannelId}
        onChange={(v) => update("modNotesChannelId", v)}
        channels={channels}
        filterType="text"
      />
    </Section>
  );
}

export function LoggingPanel({ settings, update, channels }: PanelProps) {
  return (
    <>
      <Section>
        <Toggle label="Enable audit logging" checked={settings.isLoggingEnabled} onChange={(v) => update("isLoggingEnabled", v)} />
        <ChannelSelect
          label="Log channel"
          description="Honeypot notices also go here whenever logging is on, whatever events are picked below."
          value={settings.logChannelId}
          onChange={(v) => update("logChannelId", v)}
          channels={channels}
          filterType="text"
        />
      </Section>
      <Section title="Events" description="Choose what gets logged.">
        <EventPicker selected={settings.logEvents} onChange={(v) => update("logEvents", v)} />
      </Section>
    </>
  );
}

/**
 * The honeypot's local UI state (the "pick a channel" hint and the typed channel count) lives here.
 * The page remounts the panel on Reset, which clears both.
 */
export function HoneypotPanel({ settings, update, channels, hasDiscordData }: PanelProps) {
  const [showChannelHint, setShowChannelHint] = useState(false);
  // Typed text of the repeated-message channel count; null when not being edited
  const [repeatCountText, setRepeatCountText] = useState<string | null>(null);
  // The same filter the channel picker uses, so the guard accepts only a channel the picker can show
  const canEnable = hasDiscordData && channels.some((c) => c.type === "text" && c.id === settings.honeypotChannelId);

  return (
    <>
      <div className="mb-4 px-4 py-3 rounded-lg border border-dc-warning/30 bg-dc-warning/10 text-sm text-dc-text-secondary">
        Changing these settings needs Manage Server or full dashboard access. Test with an alt account: if you aren&apos;t staff, posting in the trap removes you.
      </div>
      <Section title="Channel trap" description="Keeps a pinned warning in a trap channel and removes ordinary accounts that post there anyway.">
        <Toggle
          label="Enable channel trap"
          checked={settings.isHoneypotEnabled}
          onChange={(v) => {
            // Turning it on needs a channel from the loaded list; turning it off always works
            if (v && !canEnable) {
              setShowChannelHint(true);
              return;
            }
            setShowChannelHint(false);
            update("isHoneypotEnabled", v);
          }}
        />
        {showChannelHint && !canEnable && <p className="text-xs text-dc-danger -mt-3">Pick a channel first.</p>}
        <ChannelSelect
          label="Honeypot channel"
          description="Pick a channel everyone can see and post in but nobody has a reason to use."
          value={settings.honeypotChannelId}
          onChange={(v) => { setShowChannelHint(false); update("honeypotChannelId", v); }}
          channels={channels}
          filterType="text"
        />
        <div>
          <label className={FIELD_LABEL_CLASS}>Action</label>
          <select
            className={SELECT_CLASS}
            value={settings.honeypotAction}
            onChange={(e) => update("honeypotAction", e.target.value === "ban" ? "ban" : "kick")}
          >
            <option value="ban">Ban: removed for good</option>
            <option value="kick">Kick: removed, can rejoin</option>
          </select>
          <p className={FIELD_HINT_CLASS}>
            Their messages from the last hour are cleaned up across the whole server either way. Verified members only have the
            message deleted. Staff (Administrator, Manage Server, Kick Members or Ban Members) are ignored.
          </p>
        </div>
      </Section>
      <Section
        title="Repeated messages"
        description={<>Kicks an account that posts the same message in several different channels within a minute, and cleans up its messages from the last hour. Short messages like &quot;gm&quot; never count. Verified members and staff are never affected.</>}
      >
        <Toggle label="Enable repeated-message check" checked={settings.isRepeatSpamEnabled} onChange={(v) => update("isRepeatSpamEnabled", v)} />
        <Divider />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={FIELD_LABEL_CLASS}>Kick after this many channels</label>
            <input
              type="number"
              className={TEXT_INPUT_CLASS}
              value={repeatCountText ?? String(settings.repeatSpamChannelCount)}
              onChange={(e) => {
                setRepeatCountText(e.target.value);
                // A valid in-range number counts at once, so Save enables while typing and a click on it can't beat the blur
                const n = Number(e.target.value);
                if (e.target.value.trim() !== "" && Number.isInteger(n) && n >= REPEAT_SPAM_MIN_CHANNELS && n <= REPEAT_SPAM_MAX_CHANNELS) update("repeatSpamChannelCount", n);
              }}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) update("repeatSpamChannelCount", Math.min(REPEAT_SPAM_MAX_CHANNELS, Math.max(REPEAT_SPAM_MIN_CHANNELS, n)));
                setRepeatCountText(null);
              }}
              min={REPEAT_SPAM_MIN_CHANNELS}
              max={REPEAT_SPAM_MAX_CHANNELS}
            />
            <p className={FIELD_HINT_CLASS}>{REPEAT_SPAM_MIN_CHANNELS} to {REPEAT_SPAM_MAX_CHANNELS}.</p>
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Matching</label>
            <select
              className={SELECT_CLASS}
              value={settings.repeatSpamMatchMode}
              onChange={(e) => update("repeatSpamMatchMode", e.target.value === "exact" ? "exact" : e.target.value === "similar" ? "similar" : "ignore_case")}
            >
              <option value="exact">Word for word, case-sensitive</option>
              <option value="ignore_case">Word for word, ignoring case</option>
              <option value="similar">Too similar</option>
            </select>
          </div>
        </div>
      </Section>
    </>
  );
}
