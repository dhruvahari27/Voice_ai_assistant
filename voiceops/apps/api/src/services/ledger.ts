import { and, eq } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { actionLedger } from "../db/schema.js";
import { conflict } from "../lib/errors.js";
import { hashArgs } from "../lib/ids.js";

/**
 * Run a write at most once per action key.
 * Must be called inside a transaction: if `fn` throws, the ledger row rolls back too, so a retry can succeed.
 * Concurrent calls with the same key: the second waits on the unique index, then replays the first's result.
 */
export async function once<T>(
  tx: Executor,
  key: { businessId: string; actionKey: string; tool: string; args: unknown; callId?: string | null },
  fn: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  const argsHash = hashArgs(key.args);
  const [claimed] = await tx
    .insert(actionLedger)
    .values({ businessId: key.businessId, actionKey: key.actionKey, tool: key.tool, argsHash, callId: key.callId ?? null })
    .onConflictDoNothing()
    .returning({ id: actionLedger.id });

  if (!claimed) {
    const [existing] = await tx
      .select()
      .from(actionLedger)
      .where(and(eq(actionLedger.businessId, key.businessId), eq(actionLedger.actionKey, key.actionKey)))
      .limit(1);
    if (!existing) throw conflict("in_progress", "This action is still being processed; try again.");
    if (existing.tool !== key.tool || existing.argsHash !== argsHash) {
      throw conflict("idempotency_key_reused", "This action key was already used for a different request.");
    }
    if (existing.result === null) throw conflict("in_progress", "This action is still being processed; try again.");
    return { result: existing.result as T, replayed: true };
  }

  const result = await fn();
  await tx
    .update(actionLedger)
    .set({ result: JSON.parse(JSON.stringify(result ?? null)) })
    .where(eq(actionLedger.id, claimed.id));
  return { result, replayed: false };
}
