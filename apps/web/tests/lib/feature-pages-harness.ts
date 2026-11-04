// Test harness for the dashboard page data helpers (audit D14). It records, in one ordered log,
// every fetch (URL and init), every response.json() read, every redirect and every state setter
// call, so a test can compare the HEAD copy of a handler with the shared helper event by event.
import { vi } from "vitest";

export type Event = unknown[];

/** How a mocked URL answers: a status and a JSON body, a body that fails to parse, or a network error. */
export type Reply =
  | { status: number; body?: unknown }
  | { status: number; badJson: true }
  | { networkError: true };

export interface Harness {
  events: Event[];
  /** A setter that records [name, value]. */
  setter: (name: string) => (value: unknown) => void;
  /** Lets every pending promise and the fetch chain finish (the load helpers return nothing). */
  settle: () => Promise<void>;
}

export function installHarness(replies: Record<string, Reply>): Harness {
  const events: Event[] = [];

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    events.push(["fetch", url, init === undefined ? "no init" : JSON.parse(JSON.stringify(init))]);
    const reply = replies[url];
    if (!reply) throw new Error(`no reply for ${url}`);
    if ("networkError" in reply) return Promise.reject(new TypeError("Failed to fetch"));
    const status = reply.status;
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => {
        events.push(["json", url]);
        if ("badJson" in reply) return Promise.reject(new SyntaxError("Unexpected token < in JSON"));
        return Promise.resolve(structuredClone(reply.body));
      },
    });
  });

  const location = {};
  Object.defineProperty(location, "href", {
    set(value: string) { events.push(["redirect", value]); },
    get() { return "http://localhost/dashboard"; },
  });
  vi.stubGlobal("window", { location });

  return {
    events,
    setter: (name) => (value) => { events.push([name, value]); },
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}

/** Runs an async handler and returns how it ended, so a rejection can be compared too. */
export async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "resolved";
  } catch (err) {
    return `rejected: ${String(err)}`;
  }
}
