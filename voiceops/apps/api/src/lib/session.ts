import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionData {
  userId: string;
  businessId: string;
  role: "owner" | "staff";
  /** Fingerprint of the password hash: changing the password signs out every other session. */
  pv: string;
  exp: number; // unix seconds
}

/** Short HMAC of the user's password hash, stored in the session to detect password changes. */
export function passwordVersion(passwordHash: string, secret: string): string {
  return createHmac("sha256", secret).update(`pv:${passwordHash}`).digest("base64url").slice(0, 16);
}

export const SESSION_COOKIE = "vo_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** Stateless signed session token: base64url(payload).base64url(hmac). */
export function signSession(data: Omit<SessionData, "exp">, secret: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ ...data, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS }));
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): SessionData | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionData;
    if (typeof data.exp !== "number" || data.exp * 1000 < now) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
