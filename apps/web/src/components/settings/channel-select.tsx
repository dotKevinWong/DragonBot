import type { DiscordChannel } from "@/lib/guild-settings";
import { FIELD_HINT_CLASS, FIELD_LABEL_CLASS } from "@/lib/form-classes";
import { SinglePicker } from "./picker";
import { channelOptions, emptyPickerText } from "./picker-options";

export function ChannelSelect({ label, description, value, onChange, channels, filterType }: {
  label: string;
  description?: React.ReactNode;
  value: string | null;
  onChange: (v: string | null) => void;
  channels: DiscordChannel[];
  /** Only this channel type (e.g. "text"); without it, every type but categories. */
  filterType?: string;
}) {
  return (
    <div>
      <label className={FIELD_LABEL_CLASS}>{label}</label>
      <SinglePicker
        value={value}
        onChange={onChange}
        options={channelOptions(channels, filterType)}
        unknownKind="channel"
        emptyText={emptyPickerText(channels.length > 0, "channels")}
      />
      {description && <p className={FIELD_HINT_CLASS}>{description}</p>}
    </div>
  );
}
