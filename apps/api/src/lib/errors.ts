/**
 * Errors thrown on purpose. The error handler turns them into
 * { error: { code, message, details } } with the given HTTP status.
 * Codes are stable strings the web app and the voice agent can branch on.
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
