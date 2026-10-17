import pino from "pino";

export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    base: { service: "api" },
    redact: {
      // Never log secrets or full phone numbers.
      paths: ["req.headers.authorization", "req.headers.cookie", "*.phone", "*.token"],
      censor: "[redacted]",
    },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
