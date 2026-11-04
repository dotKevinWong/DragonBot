import type { DiscordRole } from "@/lib/guild-settings";
import { FIELD_LABEL_CLASS, SELECT_CLASS } from "@/lib/form-classes";

export function RoleSelect({ label, value, onChange, roles }: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  roles: DiscordRole[];
}) {
  return (
    <div>
      <label className={FIELD_LABEL_CLASS}>{label}</label>
      <select
        className={SELECT_CLASS}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">None</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            @{role.name}
          </option>
        ))}
      </select>
    </div>
  );
}
