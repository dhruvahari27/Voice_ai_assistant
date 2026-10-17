import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { EventBus } from "../lib/events.js";
import type { Logger } from "../lib/logger.js";

/** Everything a service needs. Passed explicitly so tests can swap the clock and the database. */
export interface Ctx {
  db: Db;
  config: Config;
  logger: Logger;
  events: EventBus;
  now: () => Date;
}

export type Actor =
  | { kind: "agent"; callId?: string }
  | { kind: "user"; userId: string }
  | { kind: "customer"; phone: string }
  | { kind: "system" };

export function actorFields(a: Actor): { actor: "agent" | "user" | "customer" | "system"; actorId: string | null } {
  switch (a.kind) {
    case "agent":
      return { actor: "agent", actorId: a.callId ?? null };
    case "user":
      return { actor: "user", actorId: a.userId };
    case "customer":
      return { actor: "customer", actorId: a.phone };
    default:
      return { actor: "system", actorId: null };
  }
}
