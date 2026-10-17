import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Express middleware factory that validates `req[target]` against a Zod schema.
 * On success the parsed (and possibly coerced) value replaces the raw value.
 * On failure a 400 response is returned with structured error details.
 */
export function validate(schema: ZodSchema, target: ValidationTarget = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      res.status(400).json({
        message: 'Validation failed.',
        errors: result.error.issues.map((issue: any) => ({
          path: (issue.path as any[]).map(String).join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    // Replace with parsed & coerced values
    (req as any)[target] = result.data;
    next();
  };
}

