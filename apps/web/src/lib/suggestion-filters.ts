// The suggestions page's filter tabs. Imports only the dependency-free contracts subpath, so the
// client page can use it.
import { SUGGESTION_STATUSES, type SuggestionStatus } from "@dragonbot/db/contracts";

export type StatusFilter = "all" | SuggestionStatus;

/** Tab order: "all" (everything but archived), then every status in SUGGESTION_STATUSES order. */
export const STATUS_FILTERS = ["all", ...SUGGESTION_STATUSES] as const satisfies readonly StatusFilter[];
