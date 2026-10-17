import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** Which cached queries each server event makes stale. */
const INVALIDATES: Record<string, string[]> = {
  "call.started": ["overview", "calls"],
  "call.turn": ["calls", "call"],
  "call.ended": ["overview", "calls", "call", "insights"],
  "appointment.changed": ["overview", "appointments"],
  "callback.changed": ["overview", "callbacks", "counts"],
  "handoff.changed": ["overview", "handoffs", "counts"],
  "waitlist.changed": ["waitlist", "counts"],
  "message.created": ["messages"],
  "knowledge.changed": ["knowledge", "insights"],
};

/** Keep the dashboard current without polling: listen to the server's event stream. */
export function useLiveUpdates(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/v1/events", { withCredentials: true });
    const handlers = Object.entries(INVALIDATES).map(([type, keys]) => {
      const fn = () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      es.addEventListener(type, fn);
      return [type, fn] as const;
    });
    return () => {
      handlers.forEach(([type, fn]) => es.removeEventListener(type, fn));
      es.close();
    };
  }, [enabled, qc]);
}
