// Class strings the dashboard forms share. Keep each a whole literal string so
// Tailwind's source scan sees every class.

/** The label above a field (Discord's settings use sentence-case labels, not uppercase). */
export const FIELD_LABEL_CLASS = "block text-sm font-medium text-dc-text-primary mb-2";

/** A full-width text or number input. */
export const TEXT_INPUT_CLASS =
  "w-full px-3 py-2.5 bg-dc-input border border-dc-border rounded-lg text-dc-text-primary text-sm outline-none placeholder:text-dc-text-muted hover:border-[#3d3d45] focus:border-dc-accent transition-colors";

/** A full-width select. */
export const SELECT_CLASS =
  "w-full px-3 py-2.5 bg-dc-input border border-dc-border rounded-lg text-dc-text-primary text-sm outline-none hover:border-[#3d3d45] focus:border-dc-accent transition-colors cursor-pointer";

/** A multi-line textarea. */
export const TEXTAREA_CLASS =
  "w-full px-3 py-2.5 bg-dc-input border border-dc-border rounded-lg text-dc-text-primary text-sm outline-none placeholder:text-dc-text-muted hover:border-[#3d3d45] focus:border-dc-accent transition-colors resize-y min-h-24";

/** Small help text under a field. */
export const FIELD_HINT_CLASS = "text-xs text-dc-text-muted mt-1.5";

/** Discord's primary (blurple) button. */
export const PRIMARY_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 px-4 h-9 bg-dc-accent hover:bg-dc-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed";

/** Discord's secondary (grey) button. */
export const SECONDARY_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 px-4 h-9 bg-[#2e2e34] hover:bg-[#3a3a41] disabled:opacity-50 text-dc-text-primary text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed";
