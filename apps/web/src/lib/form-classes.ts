// Class strings the dashboard forms repeat. Each is the exact string the pages wrote out in the markup;
// only byte-identical copies use these. Variants (a different token order, no transition-colors,
// textareas with resize/min-h) stay written out in the markup on purpose. Keep each a whole literal string so
// Tailwind's source scan sees every class.

/** The small uppercase label above a field. */
export const FIELD_LABEL_CLASS = "block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5";

/** A full-width text or number input. */
export const TEXT_INPUT_CLASS =
  "w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors";

/** A full-width select (TEXT_INPUT_CLASS plus cursor-pointer, in that order). */
export const SELECT_CLASS =
  "w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors cursor-pointer";
