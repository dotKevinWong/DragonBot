// Browser-side fetch helpers for the dashboard pages. No imports, so any client component can use it.

/**
 * On a 401 (session missing or expired), sends the browser to "/" and returns true. The caller
 * returns straight away and leaves its state alone: loading stays on while the page navigates.
 * Only the responses the pages already checked for 401 use this; mutations never did.
 */
export function redirectIfUnauthorized(res: Response): boolean {
  if (res.status === 401) {
    window.location.href = "/";
    return true;
  }
  return false;
}

/** A GET that sends the session cookie. */
export function getSameOrigin(url: string): Promise<Response> {
  return fetch(url, { credentials: "same-origin" });
}

/** A POST or PATCH with a JSON body and the session cookie. Returns the raw response. */
export function sendJson(url: string, method: "POST" | "PATCH", body: unknown): Promise<Response> {
  return fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A DELETE with the session cookie and no body. Returns the raw response. */
export function sendDelete(url: string): Promise<Response> {
  return fetch(url, {
    method: "DELETE",
    credentials: "same-origin",
  });
}
