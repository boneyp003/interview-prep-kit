import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "./errors.js";

/** Validate and replace `req.body` with the parsed value. */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        AppError.badRequest("Request body failed validation", {
          issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        }),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}
