import { Toggle } from "../toggle";
import { Section, Divider } from "../section";
import { RoleSelect } from "../role-select";
import { ChannelSelect } from "../channel-select";
import { PlaceholderTextarea } from "../placeholder-textarea";
import { FIELD_LABEL_CLASS, TEXT_INPUT_CLASS } from "@/lib/form-classes";
import { filterTextChannels } from "@/lib/feature-list";
import { MESSAGE_PLACEHOLDERS, type PanelProps } from "./types";

export function VerificationPanel({ settings, update, roles }: PanelProps) {
  return (
    <Section>
      <Toggle
        label="Sync verification across servers"
        description="Members who verified their Drexel email in another DragonBot server get the role here when they join."
        checked={settings.isVerificationSyncEnabled}
        onChange={(v) => update("isVerificationSyncEnabled", v)}
      />
      <Divider />
      <RoleSelect
        label="Verification role"
        description="Given to members after /verify. Verified members are also spared by the honeypot."
        value={settings.verificationRoleId}
        onChange={(v) => update("verificationRoleId", v)}
        roles={roles}
      />
    </Section>
  );
}

export function WelcomePanel({ settings, update, channels }: PanelProps) {
  const textChannels = filterTextChannels(channels);
  return (
    <>
      <Section title="Channel welcome" description="A message posted in a channel when someone joins.">
        <Toggle label="Enable channel welcome" checked={settings.isWelcomeEnabled} onChange={(v) => update("isWelcomeEnabled", v)} />
        <ChannelSelect label="Welcome channel" value={settings.welcomeChannelId} onChange={(v) => update("welcomeChannelId", v)} channels={channels} filterType="text" />
        <PlaceholderTextarea
          label="Welcome message"
          value={settings.welcomeMessage ?? ""}
          onChange={(v) => update("welcomeMessage", v || null)}
          placeholder="Welcome to {server}, {member}!"
          placeholders={MESSAGE_PLACEHOLDERS}
          channels={textChannels}
        />
      </Section>
      <Section title="DM welcome" description="A private message sent to each new member.">
        <Toggle label="Enable DM welcome" checked={settings.isDmWelcomeEnabled} onChange={(v) => update("isDmWelcomeEnabled", v)} />
        <PlaceholderTextarea
          label="DM welcome message"
          value={settings.dmWelcomeMessage ?? ""}
          onChange={(v) => update("dmWelcomeMessage", v || null)}
          placeholder="Welcome! Please introduce yourself."
          placeholders={MESSAGE_PLACEHOLDERS}
          channels={textChannels}
        />
      </Section>
    </>
  );
}

function NumberField({ label, hint, value, onChange, min, max }: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max?: number;
}) {
  return (
    <div>
      <label className={FIELD_LABEL_CLASS}>
        {label}
        {hint && <span className="ml-1 inline-block cursor-help text-dc-text-muted" title={hint}>&#9432;</span>}
      </label>
      <input type="number" className={TEXT_INPUT_CLASS} value={value} onChange={(e) => onChange(parseInt(e.target.value) || 0)} min={min} max={max} />
    </div>
  );
}

export function IntroGatePanel({ settings, update, channels, roles }: PanelProps) {
  return (
    <>
      <Section>
        <Toggle
          label="Enable intro gate"
          description="Messages in the intro channel are checked. A good intro earns the intro role; a weak one is deleted and the member gets a DM saying why."
          checked={settings.isIntroGateEnabled}
          onChange={(v) => update("isIntroGateEnabled", v)}
        />
        <Divider />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ChannelSelect label="Intro channel" value={settings.introChannelId} onChange={(v) => update("introChannelId", v)} channels={channels} filterType="text" />
          <RoleSelect label="Intro role" value={settings.introRoleId} onChange={(v) => update("introRoleId", v)} roles={roles} />
        </div>
      </Section>
      <Section title="Quality checks" description="Set any check to 0 to turn it off.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField label="Min characters" value={settings.introMinChars} onChange={(v) => update("introMinChars", v)} min={0} />
          <NumberField label="Min words" value={settings.introMinWords} onChange={(v) => update("introMinWords", v)} min={0} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumberField
            label="Min substantive words"
            hint="Words that aren't common filler (hi, hey, the, from, etc.). A real intro should mention names, majors, hobbies. Set to 0 to disable."
            value={settings.introMinSubstantiveWords}
            onChange={(v) => update("introMinSubstantiveWords", v)}
            min={0}
            max={100}
          />
          <NumberField
            label="Unique word ratio %"
            hint="Minimum percentage of words that must be unique. Catches repetitive spam like 'hi hi hi hi hi'. Set to 0 to disable."
            value={settings.introUniqueWordRatio}
            onChange={(v) => update("introUniqueWordRatio", v)}
            min={0}
            max={100}
          />
          <NumberField
            label="Max repeated char %"
            hint="Reject if any single character makes up more than this percentage of the message. Catches padding like 'aaaaaaa'. Set to 0 to disable."
            value={settings.introMaxRepeatedCharPct}
            onChange={(v) => update("introMaxRepeatedCharPct", v)}
            min={0}
            max={100}
          />
        </div>
      </Section>
    </>
  );
}
