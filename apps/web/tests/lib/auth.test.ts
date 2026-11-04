import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization of apps/web/src/lib/auth.ts session-token extraction (D8,
// X10): cookie parsing quirks, the Bearer fallback, and the deliberate
// difference between getDiscordIdFromRequest (invalid cookie falls through to
// Bearer) and getAuthenticatedUser (invalid cookie is final). Real jose.

const state = vi.hoisted(() => ({
  userRow: { jwtInvalidBefore: null as Date | null } as { jwtInvalidBefore: Date | null } | undefined,
  selects: 0,
}));

vi.mock("@/lib/env", () => ({ env: { JWT_SECRET: "x".repeat(40), DATABASE_URL: "postgres://unused" } }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      state.selects++;
      return {
        from: () => ({
          where: () => ({
            limit: async () => (state.userRow ? [state.userRow] : []),
          }),
        }),
      };
    },
  },
}));

import { SignJWT } from "jose";
import {
  signJwt,
  verifyJwt,
  getDiscordIdFromRequest,
  getAuthenticatedUser,
  createSessionCookie,
  clearSessionCookie,
} from "@/lib/auth";

const A = "100000000000000001";
const B = "100000000000000002";

function req(headers: Record<string, string>) {
  return new Request("http://localhost/api/x", { headers });
}

let tokA: string;
let tokB: string;
beforeEach(async () => {
  tokA ??= await signJwt(A);
  tokB ??= await signJwt(B);
  state.userRow = { jwtInvalidBefore: null };
  state.selects = 0;
});

const both = async (headers: Record<string, string>) => ({
  logout: await getDiscordIdFromRequest(req(headers)),
  auth: await getAuthenticatedUser(req(headers)),
});

describe("session token extraction", () => {
  it("valid cookie only", async () => {
    expect(await both({ cookie: `dragonbot_session=${tokA}` })).toEqual({ logout: A, auth: A });
  });

  it("valid Bearer only (legacy fallback kept)", async () => {
    expect(await both({ Authorization: `Bearer ${tokA}` })).toEqual({ logout: A, auth: A });
  });

  it("neither header", async () => {
    expect(await both({})).toEqual({ logout: null, auth: null });
    expect(state.selects).toBe(0);
  });

  it("empty cookie value counts as absent and falls through to Bearer in both", async () => {
    expect(await both({ cookie: "dragonbot_session=", Authorization: `Bearer ${tokA}` })).toEqual({ logout: A, auth: A });
  });

  it("cookie among several cookies, with spaces", async () => {
    // the whole pair is trimmed, so trailing spaces before ";" are dropped
    expect(await both({ cookie: `a=1;  dragonbot_session=${tokA} ; b=2=3` })).toEqual({ logout: A, auth: A });
    expect(await both({ cookie: `a=1;  dragonbot_session=${tokA}; b=2=3` })).toEqual({ logout: A, auth: A });
  });

  it("duplicate cookie names: last one wins", async () => {
    expect(await both({ cookie: `dragonbot_session=${tokB}; dragonbot_session=${tokA}` })).toEqual({ logout: A, auth: A });
    expect(await both({ cookie: `dragonbot_session=${tokA}; dragonbot_session=junk` })).toEqual({ logout: null, auth: null });
  });

  it("a value containing '=' is rejoined", async () => {
    // the rejoined value keeps its "=": jose accepts trailing padding, a mid-token "=x" breaks it
    expect(await both({ cookie: `dragonbot_session=${tokA}=` })).toEqual({ logout: A, auth: A });
    expect(await both({ cookie: `dragonbot_session=${tokA}=x` })).toEqual({ logout: null, auth: null });
  });

  it("no URL-decoding of the cookie value", async () => {
    expect(await both({ cookie: `dragonbot_session=${encodeURIComponent(tokA).replace(/\./g, "%2E")}` })).toEqual({ logout: null, auth: null });
  });

  it("a cookie header with no '=' is ignored", async () => {
    expect(await both({ cookie: "garbage", Authorization: `Bearer ${tokA}` })).toEqual({ logout: A, auth: A });
  });

  it("'Bearer' without a space, empty Bearer, lowercase bearer are not accepted", async () => {
    expect(await both({ Authorization: `Bearer${tokA}` })).toEqual({ logout: null, auth: null });
    expect(await both({ Authorization: "Bearer " })).toEqual({ logout: null, auth: null });
    expect(await both({ Authorization: `bearer ${tokA}` })).toEqual({ logout: null, auth: null });
  });

  it("invalid cookie + valid Bearer: logout falls through, auth does not", async () => {
    expect(await both({ cookie: "dragonbot_session=junk", Authorization: `Bearer ${tokA}` })).toEqual({ logout: A, auth: null });
  });

  it("valid cookie + different valid Bearer: cookie wins in both", async () => {
    expect(await both({ cookie: `dragonbot_session=${tokA}`, Authorization: `Bearer ${tokB}` })).toEqual({ logout: A, auth: A });
  });

  it("valid cookie + invalid Bearer: cookie user in both", async () => {
    expect(await both({ cookie: `dragonbot_session=${tokA}`, Authorization: "Bearer junk" })).toEqual({ logout: A, auth: A });
  });

  it("invalid cookie + invalid Bearer", async () => {
    expect(await both({ cookie: "dragonbot_session=junk", Authorization: "Bearer junk" })).toEqual({ logout: null, auth: null });
  });

  it("a token with no discord_id is rejected", async () => {
    const secret = new TextEncoder().encode("x".repeat(40));
    const tok = await new SignJWT({ foo: 1 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
    expect(await verifyJwt(tok)).toBeNull();
    expect(await both({ cookie: `dragonbot_session=${tok}` })).toEqual({ logout: null, auth: null });
  });
});

describe("getAuthenticatedUser revocation", () => {
  it("no user row gives null", async () => {
    state.userRow = undefined;
    expect(await getAuthenticatedUser(req({ cookie: `dragonbot_session=${tokA}` }))).toBeNull();
    // logout does not check the users table
    expect(await getDiscordIdFromRequest(req({ cookie: `dragonbot_session=${tokA}` }))).toBe(A);
  });

  it("iat before jwtInvalidBefore gives null; after gives the id", async () => {
    const payload = await verifyJwt(tokA);
    state.userRow = { jwtInvalidBefore: new Date(payload!.iat * 1000 + 1000) };
    expect(await getAuthenticatedUser(req({ cookie: `dragonbot_session=${tokA}` }))).toBeNull();
    state.userRow = { jwtInvalidBefore: new Date(payload!.iat * 1000) };
    expect(await getAuthenticatedUser(req({ cookie: `dragonbot_session=${tokA}` }))).toBe(A);
    state.userRow = { jwtInvalidBefore: new Date(payload!.iat * 1000 - 1000) };
    expect(await getAuthenticatedUser(req({ cookie: `dragonbot_session=${tokA}` }))).toBe(A);
    expect(state.selects).toBe(3);
  });
});

describe("session cookies", () => {
  it("are unchanged", () => {
    expect(clearSessionCookie()).toBe("dragonbot_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    expect(createSessionCookie("jwt")).toMatch(/^dragonbot_session=jwt; Path=\/; HttpOnly; SameSite=Lax; Max-Age=86400(; Secure)?$/);
  });
});
