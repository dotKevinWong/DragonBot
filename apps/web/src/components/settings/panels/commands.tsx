import { Toggle } from "../toggle";
import { Section, Divider } from "../section";
import { PlaceholderTextarea } from "../placeholder-textarea";
import { TagInput } from "../tag-input";
import { FIELD_HINT_CLASS, FIELD_LABEL_CLASS, TEXTAREA_CLASS } from "@/lib/form-classes";
import { filterTextChannels } from "@/lib/feature-list";
import type { PanelProps } from "./types";

export function AskPanel({ settings, update }: PanelProps) {
  return (
    <Section>
      <Toggle
        label="Enable /ask"
        description="Verified members can ask the AI a question. It can search the web for current answers."
        checked={settings.isAskEnabled}
        onChange={(v) => update("isAskEnabled", v)}
      />
      <Divider />
      <div>
        <label className={FIELD_LABEL_CLASS}>System prompt</label>
        <textarea
          className={TEXTAREA_CLASS}
          value={settings.askSystemPrompt ?? ""}
          onChange={(e) => update("askSystemPrompt", e.target.value || null)}
          placeholder="Custom system prompt for the AI..."
        />
        <p className={FIELD_HINT_CLASS}>Tells the AI how to answer. Don&apos;t put anything secret here.</p>
      </div>
    </Section>
  );
}

export function OffTopicPanel({ settings, update, channels }: PanelProps) {
  return (
    <Section description="What /offtopic replies with: your message and one of the images, picked at random.">
      <PlaceholderTextarea
        label="Response message"
        value={settings.offtopicMessage ?? ""}
        onChange={(v) => update("offtopicMessage", v || null)}
        placeholder="Please move this conversation to #off-topic"
        channels={filterTextChannels(channels)}
      />
      <div>
        <label className={FIELD_LABEL_CLASS}>Image URLs</label>
        <TagInput values={settings.offtopicImages} onChange={(v) => update("offtopicImages", v)} placeholder="Paste an image URL and press Enter" />
      </div>
    </Section>
  );
}
