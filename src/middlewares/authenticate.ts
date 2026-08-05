import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            userId?: string;
        }
    }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
        throw new AppError(
            401,
            'UNAUTHORIZED',
            'Missing or malformed authorization header'
        );
    }

    const token = header.slice(7);

    try {
        const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
        req.userId = payload.sub;
        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw new AppError(401, 'TOKEN_EXPIRED', 'Token has expired');
        }
        throw new AppError(401, 'UNAUTHORIZED', 'Invalid token');
    }
}