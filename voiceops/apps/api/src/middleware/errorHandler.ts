import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../lib/errors.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: "route_not_found", message: `No route for ${req.method} ${req.path}` },
    requestId: String(req.id ?? ""),
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
      requestId: String(req.id ?? ""),
    });
    return;
  }

  // Malformed JSON body from express.json()
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({
      error: { code: "invalid_json", message: "Request body is not valid JSON" },
      requestId: String(req.id ?? ""),
    });
    return;
  }

  req.log?.error({ err }, "unhandled error");
  res.status(500).json({
    error: { code: "internal_error", message: "Something went wrong" },
    requestId: String(req.id ?? ""),
  });
};
