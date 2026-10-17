import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/api — works from src/ (dev) and dist/ (build). */
export const API_ROOT = path.resolve(here, "..");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  /** Comma-separated list of allowed CORS origins. */
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  /** Empty = embedded Postgres (PGlite) stored in PGLITE_DIR. Set a postgres:// URL to use a real server. */
  DATABASE_URL: optionalString,
  PGLITE_DIR: z.string().default(path.join(API_ROOT, ".data", "pglite")),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SESSION_SECRET: z.string().default("dev-only-session-secret-change-me-in-production"),
  AGENT_SERVICE_TOKEN: z.string().default("dev-agent-token-change-me"),
  /** Seed demo history (synthetic calls) on first start so insights have something to show. */
  SEED_DEMO_HISTORY: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Show "Try the demo" on the sign-in page and allow the demo owner to sign in. Off by default in production. */
  DEMO_LOGIN: z.enum(["true", "false"]).optional(),
  /** Let new businesses create an account from the sign-in page. */
  SIGNUP_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  JOBS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Optional LLM (any OpenAI-compatible API: OpenAI, Groq, Gemini, OpenRouter, Ollama).
  LLM_API_KEY: optionalString,
  LLM_BASE_URL: z.string().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  // Optional WhatsApp Cloud API. Without these, messages are simulated and shown in the dashboard.
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  WHATSAPP_ACCESS_TOKEN: optionalString,
});

export type Config = Omit<z.infer<typeof EnvSchema>, "DEMO_LOGIN"> & { DEMO_LOGIN: boolean };

/** Parse env once at startup; fail fast with a readable message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const config: Config = {
    ...parsed.data,
    DEMO_LOGIN: parsed.data.DEMO_LOGIN ? parsed.data.DEMO_LOGIN === "true" : parsed.data.NODE_ENV !== "production",
  };
  if (config.NODE_ENV === "production") {
    if (config.SESSION_SECRET.startsWith("dev-only")) throw new Error("Set SESSION_SECRET in production.");
    if (config.AGENT_SERVICE_TOKEN.startsWith("dev-")) throw new Error("Set AGENT_SERVICE_TOKEN in production.");
  }
  return config;
}

export const APP_VERSION = "0.2.0";
