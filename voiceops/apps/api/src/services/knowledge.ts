import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { knowledgeGaps, knowledgeItems } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { normalize } from "../nlu/normalize.js";
import type { Ctx } from "./context.js";

export type KnowledgeRow = typeof knowledgeItems.$inferSelect;

// Words that carry no meaning for matching a question to an FAQ.
const STOP = new Set(
  (
    "a an the is are am was do does did you your yours i me my we our us to of in on at for with and or it this that " +
    "there any have has can could will would should please tell know want about kya hai hain ka ki ke ko se mein me " +
    "aap aapke aapka koi bhi hota hoti milega milegi kar karte karna sakte sakta mujhe batao bataiye ji bhai sir what " +
    "how which when where why yes no ok okay hello hi also be get give provide offer offers"
  ).split(" "),
);

function contentWords(text: string): string[] {
  return normalize(text)
    .tokens.filter((t) => !STOP.has(t) && t.length > 1)
    .map((t) => t.replace(/(ing|es|s)$/, "")); // light stemming: "parts" ~ "part"
}

export interface KnowledgeMatch {
  item: KnowledgeRow;
  score: number;
}

/**
 * Grounded answers only. Scores each FAQ by word overlap with its question and tags;
 * below the threshold we say "I don't know" rather than guess.
 */
export async function searchKnowledge(ex: Executor, businessId: string, question: string): Promise<KnowledgeMatch | undefined> {
  const items = await ex
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.businessId, businessId), eq(knowledgeItems.active, true)));
  const q = new Set(contentWords(question));
  if (!q.size) return undefined;
  let best: KnowledgeMatch | undefined;
  for (const item of items) {
    const qWords = new Set(contentWords(item.question));
    const tagPhrases = item.tags.map((t) => normalize(t).text);
    const tagWords = new Set(tagPhrases.flatMap((t) => contentWords(t)));
    let hits = 0;
    for (const w of q) if (qWords.has(w) || tagWords.has(w)) hits++;
    const qText = normalize(question).text;
    const phraseHits = tagPhrases.filter((p) => p.includes(" ") && qText.includes(p)).length;
    const score = (hits + phraseHits) / Math.max(2, Math.min(q.size, 6));
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= 0.34 ? best : undefined;
}

/** Remember a question we couldn't answer; similar questions are grouped by trigram similarity. */
export async function recordGap(ctx: Ctx, input: { businessId: string; question: string; callId?: string | null }) {
  const norm = contentWords(input.question).join(" ").slice(0, 200) || normalize(input.question).text.slice(0, 200);
  if (!norm) return;
  const similar = (await ctx.db.execute(sql`
    SELECT id FROM knowledge_gaps
    WHERE business_id = ${input.businessId} AND resolved = false AND similarity(normalized, ${norm}) > 0.45
    ORDER BY similarity(normalized, ${norm}) DESC LIMIT 1
  `)) as unknown as { rows: { id: string }[] };
  const existing = similar.rows[0];
  if (existing) {
    await ctx.db
      .update(knowledgeGaps)
      .set({ count: sql`${knowledgeGaps.count} + 1`, lastCallId: input.callId ?? null, lastAskedAt: ctx.now() })
      .where(eq(knowledgeGaps.id, existing.id));
  } else {
    await ctx.db
      .insert(knowledgeGaps)
      .values({ businessId: input.businessId, question: input.question.slice(0, 300), normalized: norm, lastCallId: input.callId ?? null, lastAskedAt: ctx.now() })
      .onConflictDoUpdate({
        target: [knowledgeGaps.businessId, knowledgeGaps.normalized],
        set: { count: sql`${knowledgeGaps.count} + 1`, lastAskedAt: ctx.now(), resolved: false },
      });
  }
  ctx.events.publish({ type: "knowledge.changed", businessId: input.businessId });
}

export async function listKnowledge(ex: Executor, businessId: string) {
  return ex.select().from(knowledgeItems).where(eq(knowledgeItems.businessId, businessId)).orderBy(asc(knowledgeItems.question));
}

export async function listGaps(ex: Executor, businessId: string) {
  return ex
    .select()
    .from(knowledgeGaps)
    .where(and(eq(knowledgeGaps.businessId, businessId), eq(knowledgeGaps.resolved, false)))
    .orderBy(desc(knowledgeGaps.count), desc(knowledgeGaps.lastAskedAt));
}

export async function upsertKnowledge(
  ctx: Ctx,
  input: { businessId: string; id?: string; question: string; answer: string; tags: string[]; active?: boolean; resolveGapId?: string },
) {
  const values = { question: input.question.trim(), answer: input.answer.trim(), tags: input.tags.map((t) => t.trim()).filter(Boolean), active: input.active ?? true };
  let row: KnowledgeRow | undefined;
  if (input.id) {
    [row] = await ctx.db
      .update(knowledgeItems)
      .set({ ...values, updatedAt: ctx.now() })
      .where(and(eq(knowledgeItems.id, input.id), eq(knowledgeItems.businessId, input.businessId)))
      .returning();
    if (!row) throw notFound("Knowledge item");
  } else {
    [row] = await ctx.db.insert(knowledgeItems).values({ ...values, businessId: input.businessId }).returning();
  }
  if (input.resolveGapId) {
    await ctx.db
      .update(knowledgeGaps)
      .set({ resolved: true })
      .where(and(eq(knowledgeGaps.id, input.resolveGapId), eq(knowledgeGaps.businessId, input.businessId)));
  }
  ctx.events.publish({ type: "knowledge.changed", businessId: input.businessId });
  return row!;
}

export async function deleteKnowledge(ctx: Ctx, businessId: string, id: string) {
  const [row] = await ctx.db.delete(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.businessId, businessId))).returning();
  if (!row) throw notFound("Knowledge item");
  ctx.events.publish({ type: "knowledge.changed", businessId });
}

export async function dismissGap(ctx: Ctx, businessId: string, id: string) {
  await ctx.db.update(knowledgeGaps).set({ resolved: true }).where(and(eq(knowledgeGaps.id, id), eq(knowledgeGaps.businessId, businessId)));
  ctx.events.publish({ type: "knowledge.changed", businessId });
}
