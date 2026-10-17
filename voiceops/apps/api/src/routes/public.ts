/**
 * Public routes for the web talk widget and the Python phone agent.
 *   /public/:slug/...  — anyone (rate limited). Web callers are never "verified".
 *   /agent/...         — the phone agent with AGENT_SERVICE_TOKEN. Caller ID from the phone network is trusted.
 */
import { Router } from "express";
import { z } from "zod";
import { formatPaise } from "@voiceops/shared";
import { parse } from "../lib/validate.js";
import { requireAgentToken } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import type { Receptionist } from "../receptionist/index.js";
import { runTool, TOOL_NAMES } from "../receptionist/tools.js";
import { initialState, type ConvState } from "../receptionist/state.js";
import { getBusiness, getBusinessBySlug, listHours, listServices, summariseHours } from "../services/business.js";
import { getCall } from "../services/calls.js";
import type { Ctx } from "../services/context.js";
import { toE164 } from "../nlu/entities.js";
import { badRequest } from "../lib/errors.js";
import { saveState } from "../services/calls.js";
import { processInbound } from "../services/inbound.js";

const Slug = z.object({ slug: z.string().regex(/^[a-z0-9-]{2,64}$/) });
const CallParams = Slug.extend({ callId: z.string().uuid() });
const Start = z.object({ engine: z.enum(["rules", "llm"]).optional(), lang: z.enum(["en", "hi"]).optional() });
const Turn = z.object({ text: z.string().min(1).max(1000) });

export function publicRouter(ctx: Ctx, deps: { receptionist: Receptionist }) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60000, max: 60 });

  r.get("/public/:slug", async (req, res) => {
    const { slug } = parse(Slug, req.params);
    const b = await getBusinessBySlug(ctx.db, slug);
    const [svc, hours] = await Promise.all([listServices(ctx.db, b.id), listHours(ctx.db, b.id)]);
    res.json({
      name: b.name,
      city: b.city,
      hours: summariseHours(hours),
      llmAvailable: deps.receptionist.llmAvailable,
      services: svc.map((s) => ({ name: s.name, price: formatPaise(s.pricePaise), durationMin: s.durationMin })),
    });
  });

  r.post("/public/:slug/calls", limiter, async (req, res) => {
    const { slug } = parse(Slug, req.params);
    const body = parse(Start, req.body);
    const b = await getBusinessBySlug(ctx.db, slug);
    res.status(201).json(await deps.receptionist.start({ businessId: b.id, channel: "web", engine: body.engine, lang: body.lang }));
  });

  r.post("/public/:slug/calls/:callId/turns", limiter, async (req, res) => {
    const { slug, callId } = parse(CallParams, req.params);
    const { text } = parse(Turn, req.body);
    const b = await getBusinessBySlug(ctx.db, slug);
    res.json(await deps.receptionist.turn({ businessId: b.id, callId, text }));
  });

  r.post("/public/:slug/calls/:callId/end", async (req, res) => {
    const { slug, callId } = parse(CallParams, req.params);
    const b = await getBusinessBySlug(ctx.db, slug);
    res.json(await deps.receptionist.end({ businessId: b.id, callId }));
  });

  // ------------------------------------------------------------------ phone agent
  const agent = Router();
  agent.use(requireAgentToken(ctx.config.AGENT_SERVICE_TOKEN));

  agent.post("/calls", async (req, res) => {
    const body = parse(
      z.object({ businessSlug: z.string(), callerPhone: z.string().optional(), engine: z.enum(["rules", "llm"]).optional(), lang: z.enum(["en", "hi"]).optional() }),
      req.body,
    );
    const b = await getBusinessBySlug(ctx.db, body.businessSlug);
    const phone = body.callerPhone ? toE164(body.callerPhone) : undefined;
    res.status(201).json(
      await deps.receptionist.start({ businessId: b.id, channel: "phone", callerPhone: phone, callerVerified: Boolean(phone), engine: body.engine, lang: body.lang }),
    );
  });

  agent.post("/calls/:callId/turns", async (req, res) => {
    const { callId } = parse(z.object({ callId: z.string().uuid() }), req.params);
    const { text } = parse(Turn, req.body);
    const call = await getCall(ctx.db, callId);
    res.json(await deps.receptionist.turn({ businessId: call.businessId, callId, text }));
  });

  agent.post("/calls/:callId/end", async (req, res) => {
    const { callId } = parse(z.object({ callId: z.string().uuid() }), req.params);
    const call = await getCall(ctx.db, callId);
    res.json(await deps.receptionist.end({ businessId: call.businessId, callId }));
  });

  /** For a custom agent that runs its own LLM: call one tool directly. Same checks as everywhere else. */
  agent.post("/calls/:callId/tools/:name", async (req, res) => {
    const { callId, name } = parse(z.object({ callId: z.string().uuid(), name: z.string() }), req.params);
    if (!TOOL_NAMES.includes(name)) throw badRequest(`Unknown tool. Available: ${TOOL_NAMES.join(", ")}`);
    const call = await getCall(ctx.db, callId);
    const business = await getBusiness(ctx.db, call.businessId);
    const state = { ...initialState(), ...(call.state as Partial<ConvState>) } as ConvState;
    const result = await runTool({ ctx, call, state, trace: [] }, name, req.body ?? {});
    await saveState(ctx.db, call.id, state as never);
    res.json({ business: business.slug, result });
  });

  /** Inbound WhatsApp/SMS forwarded by your messaging webhook. */
  agent.post("/messages/inbound", async (req, res) => {
    const body = parse(z.object({ businessSlug: z.string(), phone: z.string(), body: z.string().min(1).max(1000) }), req.body);
    const b = await getBusinessBySlug(ctx.db, body.businessSlug);
    res.json(await processInbound(ctx, { businessId: b.id, phone: body.phone, body: body.body }));
  });

  r.use("/agent", agent);
  return r;
}
