import type { Executor } from "../db/client.js";
import { auditLog } from "../db/schema.js";
import { actorFields, type Actor } from "./context.js";

export async function audit(
  ex: Executor,
  e: { businessId: string; actor: Actor; action: string; entity: string; entityId?: string; data?: unknown },
) {
  await ex.insert(auditLog).values({
    businessId: e.businessId,
    ...actorFields(e.actor),
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    data: (e.data ?? null) as never,
  });
}
