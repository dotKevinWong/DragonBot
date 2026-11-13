import { Toggle } from "../toggle";
import { Section, Divider } from "../section";
import { ChannelSelect } from "../channel-select";
import { RoleSelect } from "../role-select";
import { MultiPicker } from "../picker";
import { channelOptions, emptyPickerText, roleOptions } from "../picker-options";
import { FIELD_HINT_CLASS, FIELD_LABEL_CLASS, SELECT_CLASS, TEXT_INPUT_CLASS, TEXTAREA_CLASS } from "@/lib/form-classes";
import { TIMEZONES } from "@/lib/timezones";
import type { PanelProps } from "./types";

export function XpPanel({ settings, update, channels, roles }: PanelProps) {
  return (
    <>
      <Section>
        <Toggle
          label="Enable XP and levels"
          description="Members earn XP for chatting (once per cooldown) and level up. /rank and /leaderboard show progress."
          checked={settings.isXpEnabled}
          onChange={(v) => update("isXpEnabled", v)}
        />
        <Divider />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={FIELD_LABEL_CLASS}>Min XP per message</label>
            <input type="number" className={TEXT_INPUT_CLASS} value={settings.xpMin} onChange={(e) => update("xpMin", parseInt(e.target.value) || 1)} min={1} max={1000} />
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Max XP per message</label>
            <input type="number" className={TEXT_INPUT_CLASS} value={settings.xpMax} onChange={(e) => update("xpMax", parseInt(e.target.value) || 1)} min={1} max={1000} />
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Cooldown (seconds)</label>
            <input type="number" className={TEXT_INPUT_CLASS} value={settings.xpCooldownSeconds} onChange={(e) => update("xpCooldownSeconds", parseInt(e.target.value) || 0)} min={0} max={3600} />
          </div>
        </div>
        <ChannelSelect
          label="Level-up announcement channel"
          description="Leave empty to skip level-up announcements."
          value={settings.xpLevelupChannelId}
          onChange={(v) => update("xpLevelupChannelId", v)}
          channels={channels}
          filterType="text"
        />
      </Section>
      <Section title="Exclusions" description="No XP is earned in these channels or by members with these roles.">
        <div>
          <label className={FIELD_LABEL_CLASS}>Excluded channels</label>
          <MultiPicker
            values={settings.xpExcludedChannelIds}
            onChange={(v) => update("xpExcludedChannelIds", v)}
            options={channelOptions(channels.filter((c) => c.type === "text" || c.type === "announcement"))}
            unknownKind="channel"
            emptyText={emptyPickerText(channels.length > 0, "channels")}
            addLabel="Add channel"
          />
        </div>
        <div>
          <label className={FIELD_LABEL_CLASS}>Excluded roles</label>
          <MultiPicker
            values={settings.xpExcludedRoleIds}
            onChange={(v) => update("xpExcludedRoleIds", v)}
            options={roleOptions(roles)}
            unknownKind="role"
            emptyText={emptyPickerText(roles.length > 0, "roles")}
            addLabel="Add role"
          />
        </div>
      </Section>
    </>
  );
}

export function BirthdaysPanel({ settings, update, channels, roles }: PanelProps) {
  return (
    <>
      <Section>
        <Toggle
          label="Enable birthday announcements"
          description="Members set their birthday with /birthday set. Birthdays are announced at 9 AM in the timezone below."
          checked={settings.isBirthdayEnabled}
          onChange={(v) => update("isBirthdayEnabled", v)}
        />
        <Divider />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ChannelSelect label="Announcement channel" value={settings.birthdayChannelId} onChange={(v) => update("birthdayChannelId", v)} channels={channels} filterType="text" />
          <RoleSelect label="Birthday role" description="Given for the day." value={settings.birthdayRoleId} onChange={(v) => update("birthdayRoleId", v)} roles={roles} />
        </div>
        <div>
          <label className={FIELD_LABEL_CLASS}>Timezone</label>
          <select className={SELECT_CLASS} value={settings.birthdayTimezone} onChange={(e) => update("birthdayTimezone", e.target.value)}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
      </Section>
      <Section title="Message">
        <div>
          <label className={FIELD_LABEL_CLASS}>Custom message</label>
          <textarea
            className={`${TEXTAREA_CLASS} min-h-16`}
            value={settings.birthdayMessage ?? ""}
            onChange={(e) => update("birthdayMessage", e.target.value || null)}
            placeholder="Happy {age} birthday {user}! 🎂🎉"
          />
          <p className={FIELD_HINT_CLASS}>
            Use <code className="px-1 rounded bg-dc-mention text-dc-mention-text">{"{user}"}</code> for the mention and{" "}
            <code className="px-1 rounded bg-dc-mention text-dc-mention-text">{"{age}"}</code> for the ordinal age (e.g. 27th). Leave blank for the default.
          </p>
        </div>
      </Section>
    </>
  );
}

export function SuggestionsPanel({ settings, update }: PanelProps) {
  return (
    <Section>
      <Toggle
        label="Enable /suggest"
        description="Members can send suggestions. They're posted to the mod notes channel (Moderation) with vote reactions, and listed on the Suggestions page."
        checked={settings.isSuggestionsEnabled}
        onChange={(v) => update("isSuggestionsEnabled", v)}
      />
    </Section>
  );
}
