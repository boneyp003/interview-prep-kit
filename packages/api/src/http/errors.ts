import type { NextFunction, Request, Response } from "express";

/** Structured, client-safe application error. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, "BAD_REQUEST", message, details);
  }
  static unauthorized(message = "Authentication required") {
    return new AppError(401, "UNAUTHORIZED", message);
  }
  static forbidden(message = "You do not have access to this resource") {
    return new AppError(403, "FORBIDDEN", message);
  }
  static notFound(message = "Not found") {
    return new AppError(404, "NOT_FOUND", message);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(409, "CONFLICT", message, details);
  }
  static unprocessable(message: string, details?: unknown) {
    return new AppError(422, "UNPROCESSABLE", message, details);
  }
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound("Route not found"));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }
  // Unexpected: don't leak internals.
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: { code: "INTERNAL", message: "An unexpected error occurred" },
  });
}

/** Wrap an async route handler so rejections reach the error middleware. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  fn: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
