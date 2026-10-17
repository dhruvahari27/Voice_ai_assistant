/**
 * Optional LLM receptionist via any OpenAI-compatible chat API (OpenAI, Groq, Gemini's OpenAI endpoint,
 * OpenRouter, a local Ollama…). The model only talks and picks tools; every write still goes through the
 * same tools and server-side checks as the rules engine. If the model errors, we fall back to the rules engine.
 */
import { formatPaise } from "@voiceops/shared";
import type { Config } from "../config.js";
import { speakDate } from "../lib/time.js";
import { summariseHours, type HoursRow } from "../services/business.js";
import type { TurnEnv } from "./rules.js";
import { runTool, toolSpecs } from "./tools.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface LlmClient {
  complete(messages: ChatMessage[], tools: ReturnType<typeof toolSpecs>): Promise<ChatMessage>;
}

export function createOpenAiCompatibleClient(config: Config): LlmClient | undefined {
  if (!config.LLM_API_KEY) return undefined;
  const base = config.LLM_BASE_URL.replace(/\/$/, "");
  return {
    async complete(messages, tools) {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.LLM_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: config.LLM_MODEL, messages, tools, tool_choice: "auto", temperature: 0.2, max_tokens: 300 }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { choices?: { message?: ChatMessage }[] };
      const msg = body.choices?.[0]?.message;
      if (!msg) throw new Error("LLM returned no message");
      return msg;
    },
  };
}

export function systemPrompt(env: TurnEnv, hours: HoursRow[]): string {
  const b = env.business;
  const services = env.services.map((s) => `- ${s.name} (${s.aliases.slice(0, 3).join(", ")}): ${formatPaise(s.pricePaise)}, ${s.durationMin} min`).join("\n");
  return `You are the phone receptionist for ${b.name}, ${b.city ?? ""}. Today is ${speakDate(env.today)} (${env.today}). Time zone ${b.timezone}.
Opening hours: ${summariseHours(hours)}.
Services:
${services}

How to speak: this is a voice call. 1–2 short sentences per reply, warm and natural. Ask for one missing detail at a time.
Mirror the caller's language: English, Hindi or Hinglish (Hindi words in Latin script). Never use lists, markdown or emojis.

Rules you must follow:
- Business facts (prices, hours, policies, anything else) only from the list above or tools. If search_knowledge returns found=false, say you're not sure and offer a callback. Never guess.
- To book: check_availability → hold_slot → collect name and 10-digit mobile → read back service, day, time and price → wait for a clear yes → book_appointment. Never say "booked" before book_appointment returns ok. If it returns status "pending", say the slot is reserved and the team will confirm on WhatsApp.
- To change or cancel: find_appointments, read back the booking, get a yes, then reschedule_appointment (hold_slot first) or cancel_appointment.
- If a tool returns ok=false, explain simply using the error message and offer the alternatives it returns, or a callback.
- If nothing suitable is free, offer join_waitlist.
- Complaints, refunds or a request for a person: request_handoff with a short summary, then tell the caller the team will call back.
- Dates in tools are YYYY-MM-DD, times HH:MM (24h). Resolve "kal" = tomorrow, "parso" = day after tomorrow, "shaam" = evening (16:00–20:00).
- When the caller is done, say goodbye and call end_call.
${env.call.callerVerified && env.call.callerPhone ? `- The caller's verified number is ${env.call.callerPhone}; don't ask for it.` : ""}`;
}

const MAX_TOOL_ROUNDS = 6;

export async function llmTurn(env: TurnEnv, client: LlmClient, hours: HoursRow[], text: string): Promise<string> {
  const s = env.state;
  const history = (s.llm as ChatMessage[] | undefined) ?? [];
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(env, hours) }, ...history, { role: "user", content: text }];
  const tools = toolSpecs();
  let reply = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const msg = await client.complete(messages, tools);
    messages.push({ role: "assistant", content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) {
      reply = (msg.content ?? "").trim();
      break;
    }
    for (const call of msg.tool_calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const result = await runTool(env, call.function.name, args);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  if (!reply) throw new Error("LLM produced no reply");
  // Keep the conversation (minus the system prompt) for the next turn; cap the size.
  s.llm = messages.slice(1).slice(-40);
  return reply;
}
