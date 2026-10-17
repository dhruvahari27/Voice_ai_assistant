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
    ...(pretty
      ? {
          transport: {
            target: "pino-pretty",
            // Colours only in a real terminal, so log files stay readable.
            options: { colorize: Boolean(process.stdout.isTTY) && process.env.FORCE_COLOR !== "0", ignore: "pid,hostname,service,reqId,_req,_res,_ms" },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
