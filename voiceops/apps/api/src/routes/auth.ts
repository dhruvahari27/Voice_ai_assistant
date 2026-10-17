/**
 * Accounts: sign in/out, self-serve sign-up for a new business, password change, and the
 * owner's team management. Owners can add staff, change roles and remove people; staff can
 * only manage their own password.
 */
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { businesses, users } from "../db/schema.js";
import { DEMO_LOGIN } from "../db/seed-data.js";
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { passwordVersion, SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "../lib/session.js";
import { parse } from "../lib/validate.js";
import { bid, requireAuth, requireOwner } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { audit } from "../services/audit.js";
import type { Ctx } from "../services/context.js";
import { createBusinessWithOwner } from "../services/onboarding.js";
import { toE164 } from "../nlu/entities.js";

const Email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const NewPassword = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(200)
  .refine((p) => !/^(.)\1+$/.test(p) && !["password", "12345678", "123456789", "qwertyui"].includes(p.toLowerCase()), "That password is too easy to guess");
const Name = z.string().trim().min(2, "Enter a name").max(80);
const OptionalPhone = z
  .string()
  .trim()
  .max(20)
  .optional()
  .transform((v, c) => {
    if (!v) return undefined;
    const e164 = toE164(v);
    if (!e164) {
      c.addIssue({ code: "custom", message: "Enter a 10-digit mobile number" });
      return z.NEVER;
    }
    return e164;
  });

const Login = z.object({ email: Email, password: z.string().min(1).max(200) });
const Signup = z.object({
  businessName: z.string().trim().min(2, "Enter your business name").max(80),
  city: z.string().trim().max(60).optional(),
  businessPhone: OptionalPhone,
  timezone: z
    .string()
    .default("Asia/Kolkata")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown timezone"),
  ownerName: Name,
  email: Email,
  password: NewPassword,
  ownerPhone: OptionalPhone,
  template: z.enum(["car_service", "blank"]).default("car_service"),
});
const ChangePassword = z.object({ currentPassword: z.string().min(1), newPassword: NewPassword });
const NewMember = z.object({ name: Name, email: Email, role: z.enum(["owner", "staff"]).default("staff"), password: NewPassword.optional() });
const Id = z.object({ id: z.string().uuid() });

/** Readable temporary password, e.g. "kite-4821-moss". */
function tempPassword() {
  const words = ["kite", "moss", "lamp", "reed", "mint", "palm", "wave", "dune", "fern", "jade", "opal", "sage", "teak", "zinc"];
  const b = randomBytes(4);
  return `${words[b[0]! % words.length]}-${1000 + (b.readUInt16BE(1) % 9000)}-${words[b[3]! % words.length]}`;
}

export function authRouter(ctx: Ctx) {
  const r = Router();
  const secret = ctx.config.SESSION_SECRET;
  const secure = ctx.config.NODE_ENV === "production";
  const sameSite = secure ? "None" : "Lax";
  const cookie = (value: string, maxAge: number) =>
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const startSession = (res: { setHeader(k: string, v: string): void }, user: typeof users.$inferSelect) => {
    const token = signSession({ userId: user.id, businessId: user.businessId, role: user.role, pv: passwordVersion(user.passwordHash, secret) }, secret);
    res.setHeader("set-cookie", cookie(token, SESSION_TTL_SECONDS));
  };
  const publicUser = (u: typeof users.$inferSelect) => ({ id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone, createdAt: u.createdAt });

  /** What the sign-in page may offer. */
  r.get("/auth/options", (_req, res) => {
    res.json({ demoLogin: ctx.config.DEMO_LOGIN ? { email: DEMO_LOGIN.email, password: DEMO_LOGIN.password } : null, signupEnabled: ctx.config.SIGNUP_ENABLED });
  });

  const ipLimiter = rateLimit({ windowMs: 15 * 60000, max: 30 });
  // Per account as well as per IP, so one address can't be guessed at from many IPs.
  const accountLimiter = rateLimit({
    windowMs: 15 * 60000,
    max: 10,
    key: (req) => `acct:${String((req.body as { email?: unknown })?.email ?? "").trim().toLowerCase()}`,
  });

  r.post("/auth/login", ipLimiter, accountLimiter, async (req, res) => {
    const body = parse(Login, req.body);
    if (!ctx.config.DEMO_LOGIN && body.email === DEMO_LOGIN.email) throw unauthorized("The demo account is turned off on this server.");
    const [user] = await ctx.db.select().from(users).where(eq(users.email, body.email)).limit(1);
    // Same error and similar timing whether the email exists or not.
    const ok = user ? await verifyPassword(body.password, user.passwordHash) : await verifyPassword(body.password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    if (!user || !ok) throw unauthorized("Wrong email or password");
    startSession(res, user);
    res.json({ user: publicUser(user) });
  });

  r.post("/auth/signup", rateLimit({ windowMs: 60 * 60000, max: 5 }), async (req, res) => {
    if (!ctx.config.SIGNUP_ENABLED) throw forbidden("Sign-up is turned off on this server. Ask the owner to add you.");
    const body = parse(Signup, req.body);
    const { business, owner } = await createBusinessWithOwner(ctx.db, body);
    await audit(ctx.db, { businessId: business.id, actor: { kind: "user", userId: owner.id }, action: "business.created", entity: "business", entityId: business.id });
    ctx.logger.info(`New business signed up: ${business.name} (${business.slug})`);
    startSession(res, owner);
    res.status(201).json({ user: publicUser(owner), business: { id: business.id, slug: business.slug, name: business.name } });
  });

  r.post("/auth/logout", (_req, res) => {
    res.setHeader("set-cookie", cookie("", 0));
    res.json({ ok: true });
  });

  // Guard each route rather than the router: this router is mounted at /api/v1 ahead of the public routes.
  const guard = requireAuth(ctx);
  const authed = r;

  authed.get("/auth/me", guard, async (req, res) => {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, req.auth!.userId)).limit(1);
    if (!user) throw unauthorized();
    const [business] = await ctx.db.select().from(businesses).where(eq(businesses.id, user.businessId)).limit(1);
    res.json({
      user: publicUser(user),
      business: { id: business!.id, slug: business!.slug, name: business!.name, timezone: business!.timezone },
      isDemoAccount: user.email === DEMO_LOGIN.email,
    });
  });

  authed.post("/auth/password", guard, rateLimit({ windowMs: 15 * 60000, max: 10 }), async (req, res) => {
    const body = parse(ChangePassword, req.body);
    const [user] = await ctx.db.select().from(users).where(eq(users.id, req.auth!.userId)).limit(1);
    if (!user) throw unauthorized();
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) throw badRequest("Your current password is wrong.", { field: "currentPassword" });
    if (body.currentPassword === body.newPassword) throw badRequest("Pick a password that's different from the current one.", { field: "newPassword" });
    const [updated] = await ctx.db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, user.id)).returning();
    await audit(ctx.db, { businessId: user.businessId, actor: { kind: "user", userId: user.id }, action: "user.password_changed", entity: "user", entityId: user.id });
    // Other devices are signed out (their session carries the old password fingerprint); this one stays in.
    startSession(res, updated!);
    res.json({ ok: true });
  });

  authed.patch("/auth/profile", guard, async (req, res) => {
    const body = parse(z.object({ name: Name.optional(), phone: OptionalPhone.or(z.literal("").transform(() => null)) }), req.body);
    const [updated] = await ctx.db
      .update(users)
      .set({ ...(body.name ? { name: body.name } : {}), ...(body.phone !== undefined ? { phone: body.phone } : {}) })
      .where(eq(users.id, req.auth!.userId))
      .returning();
    res.json({ user: publicUser(updated!) });
  });

  // ------------------------------------------------------------------ team (owner only for changes)
  authed.get("/team", guard, async (req, res) => {
    const list = await ctx.db.select().from(users).where(eq(users.businessId, bid(req))).orderBy(asc(users.createdAt));
    res.json({ members: list.map(publicUser) });
  });

  authed.post("/team", guard, requireOwner(), async (req, res) => {
    const body = parse(NewMember, req.body);
    const [taken] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (taken) throw conflict("email_taken", "Someone already uses this email. Each person needs their own.");
    const password = body.password ?? tempPassword();
    const [member] = await ctx.db
      .insert(users)
      .values({ businessId: bid(req), role: body.role, name: body.name, email: body.email, passwordHash: await hashPassword(password) })
      .returning();
    await audit(ctx.db, { businessId: bid(req), actor: { kind: "user", userId: req.auth!.userId }, action: "user.added", entity: "user", entityId: member!.id, data: { role: body.role } });
    // The temporary password is shown once, to the owner, so they can pass it on.
    res.status(201).json({ member: publicUser(member!), temporaryPassword: body.password ? null : password });
  });

  async function memberOf(req: Parameters<typeof bid>[0], id: string) {
    const [m] = await ctx.db.select().from(users).where(and(eq(users.id, id), eq(users.businessId, bid(req)))).limit(1);
    if (!m) throw notFound("Team member");
    return m;
  }
  async function assertAnotherOwner(businessId: string, exceptId: string) {
    const others = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.businessId, businessId), eq(users.role, "owner"), ne(users.id, exceptId)))
      .limit(1);
    if (!others.length) throw conflict("last_owner", "A business needs at least one owner. Make someone else an owner first.");
  }

  authed.patch("/team/:id", guard, requireOwner(), async (req, res) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ role: z.enum(["owner", "staff"]) }), req.body);
    const m = await memberOf(req, id);
    if (m.role === "owner" && body.role === "staff") await assertAnotherOwner(m.businessId, m.id);
    const [updated] = await ctx.db.update(users).set({ role: body.role }).where(eq(users.id, m.id)).returning();
    await audit(ctx.db, { businessId: m.businessId, actor: { kind: "user", userId: req.auth!.userId }, action: "user.role_changed", entity: "user", entityId: m.id, data: { role: body.role } });
    res.json({ member: publicUser(updated!) });
  });

  authed.post("/team/:id/reset-password", guard, requireOwner(), async (req, res) => {
    const { id } = parse(Id, req.params);
    const m = await memberOf(req, id);
    if (m.id === req.auth!.userId) throw badRequest("Change your own password from Account.");
    const password = tempPassword();
    await ctx.db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, m.id));
    await audit(ctx.db, { businessId: m.businessId, actor: { kind: "user", userId: req.auth!.userId }, action: "user.password_reset", entity: "user", entityId: m.id });
    res.json({ temporaryPassword: password });
  });

  authed.delete("/team/:id", guard, requireOwner(), async (req, res) => {
    const { id } = parse(Id, req.params);
    const m = await memberOf(req, id);
    if (m.id === req.auth!.userId) throw badRequest("You can't remove yourself. Ask another owner to do it.");
    if (m.role === "owner") await assertAnotherOwner(m.businessId, m.id);
    try {
      await ctx.db.delete(users).where(eq(users.id, m.id));
    } catch (err) {
      throw new AppError(409, "in_use", "This person can't be removed because records point to them.", { cause: String(err) });
    }
    await audit(ctx.db, { businessId: m.businessId, actor: { kind: "user", userId: req.auth!.userId }, action: "user.removed", entity: "user", entityId: m.id, data: { email: m.email } });
    res.json({ ok: true });
  });

  return r;
}
