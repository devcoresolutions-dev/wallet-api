import { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';

export function errorHandler(
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
  }

  console.error(error);
  return res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'Something went wrong',
  });
}
