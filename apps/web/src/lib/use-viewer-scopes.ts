// Loads the caller's grants for a guild from GET /api/server/[guildId] (its viewerScopes field), for
// pages that do not already read that response. Any failure, a 401 included, leaves the grants
// unknown (canWriteScope then allows): the page's own list request handles 401 and 403.
import { useEffect, useState } from "react";
import { getSameOrigin } from "@/lib/client-fetch";

export function useViewerScopes(guildId: string): unknown {
  const [viewerScopes, setViewerScopes] = useState<unknown>(undefined);

  useEffect(() => {
    let current = true;
    setViewerScopes(undefined);
    getSameOrigin(`/api/server/${guildId}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (current) setViewerScopes(data?.viewerScopes);
      })
      .catch(() => {});
    return () => { current = false; };
  }, [guildId]);

  return viewerScopes;
}
