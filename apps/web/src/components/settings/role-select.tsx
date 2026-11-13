import type { DiscordRole } from "@/lib/guild-settings";
import { FIELD_HINT_CLASS, FIELD_LABEL_CLASS } from "@/lib/form-classes";
import { SinglePicker } from "./picker";
import { emptyPickerText, roleOptions } from "./picker-options";

export function RoleSelect({ label, description, value, onChange, roles }: {
  label: string;
  description?: React.ReactNode;
  value: string | null;
  onChange: (v: string | null) => void;
  roles: DiscordRole[];
}) {
  return (
    <div>
      <label className={FIELD_LABEL_CLASS}>{label}</label>
      <SinglePicker
        value={value}
        onChange={onChange}
        options={roleOptions(roles)}
        unknownKind="role"
        emptyText={emptyPickerText(roles.length > 0, "roles")}
      />
      {description && <p className={FIELD_HINT_CLASS}>{description}</p>}
    </div>
  );
}
