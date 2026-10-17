import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { parseCookies, passwordVersion, SESSION_COOKIE, verifySession, type SessionData } from "../lib/session.js";
import type { Ctx } from "../services/context.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: SessionData;
    }
  }
}

/**
 * Dashboard routes: a signed session cookie scoped to one business.
 * The user is re-read on every request, so removing a team member, changing their role or
 * changing a password takes effect immediately instead of when the cookie expires.
 */
export function requireAuth(ctx: Pick<Ctx, "db" | "config">): RequestHandler {
  const secret = ctx.config.SESSION_SECRET;
  return async (req, _res, next) => {
    const session = verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE], secret);
    if (!session) throw unauthorized();
    const [user] = await ctx.db
      .select({ id: users.id, businessId: users.businessId, role: users.role, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    if (!user || user.businessId !== session.businessId || passwordVersion(user.passwordHash, secret) !== session.pv) {
      throw unauthorized("Your session has ended. Please sign in again.");
    }
    req.auth = { ...session, role: user.role };
    next();
  };
}

export function requireOwner(): RequestHandler {
  return (req, _res, next) => {
    if (req.auth?.role !== "owner") throw forbidden("Only the owner can change this.");
    next();
  };
}

/** Agent routes (Python phone agent): a shared service token in the Authorization header. */
export function requireAgentToken(token: string): RequestHandler {
  const expected = Buffer.from(token);
  return (req, _res, next) => {
    const given = Buffer.from((req.header("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized("Invalid agent token");
    next();
  };
}

/** The signed-in user's business id. */
export function bid(req: { auth?: SessionData }): string {
  if (!req.auth) throw unauthorized();
  return req.auth.businessId;
}
