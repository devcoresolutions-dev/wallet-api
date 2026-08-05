import { Request, Response } from 'express';
import { loginSchema, registerSchema } from '../schemas/auth.schemas';
import * as authService from '../services/auth.service';

export async function register(req: Request, res: Response) {
    const input = registerSchema.parse(req.body);
    const result = await authService.register(input);
    res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input);
    res.status(200).json(result);
}

export async function me(req: Request, res: Response) {
    res.json({ userId: req.userId });
}