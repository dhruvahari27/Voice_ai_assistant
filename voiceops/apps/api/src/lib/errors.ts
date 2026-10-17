/**
 * Errors thrown on purpose. The error handler turns them into
 * { error: { code, message, details } } with the given HTTP status.
 * Codes are stable strings the web app, the receptionist engine and the Python agent branch on.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} not found`);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "invalid_request", message, details);
export const unauthorized = (message = "Sign in required") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "Not allowed") => new AppError(403, "forbidden", message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
/** A booking rule said no. `code` names the rule so the agent can explain it. */
export const policyViolation = (rule: string, message: string, details?: unknown) =>
  new AppError(422, "policy_violation", message, { rule, ...(details as object) });
