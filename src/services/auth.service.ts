import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { withTransaction } from '../config/database';
import { AppError } from '../utils/AppError';
import * as userModel from '../models/user.model';
import * as walletModel from '../models/wallet.model';
import { LoginInput, RegisterInput } from '../schemas/auth.schemas';
import * as emailService from './email.service';

const SALT_ROUNDS = 10;
const TOKEN_EXPIRATION = '24h';

// Hash dummy para igualar el tiempo de respuesta cuando el email no existe.
// Sin esto, un atacante puede detectar qué emails están registrados midiendo
// cuánto tarda la respuesta.
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export interface AuthResult {
    token: string;
    user: { id: string; email: string; fullName: string };
}

function generateToken(userId: string): string {
    return jwt.sign({ sub: userId }, env.JWT_SECRET, {
        expiresIn: TOKEN_EXPIRATION,
    });
}

function toAuthResult(user: userModel.UserRow): AuthResult {
    return {
        token: generateToken(user.id),
        user: { id: user.id, email: user.email, fullName: user.full_name },
    };
}

export async function getMe(userId: string) {
    const user = await userModel.findById(userId);

    if (!user) {
        throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    return {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
    };
}


export async function register(input: RegisterInput): Promise<AuthResult> {
    const existing = await userModel.findByEmail(input.email);
    if (existing) {
        throw new AppError(
            409,
            'EMAIL_ALREADY_EXISTS',
            'An account with this email already exists'
        );
    }

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    const user = await withTransaction(async (client) => {
        const created = await userModel.create(
            client,
            input.email,
            passwordHash,
            input.fullName
        );
        await walletModel.createWithBalances(client, created.id);
        return created;
    });

    // El email va fuera de la transacción y sin await: la cuenta ya está creada,
    // así que una demora o una caída de SES no debe hacer esperar al usuario ni
    // afectar el registro. sendEmail captura sus propios errores y deja el
    // intento registrado en notifications para poder reintentarlo.
    void emailService.sendEmail({
        userId: user.id,
        type: 'WELCOME',
        recipient: user.email,
        content: emailService.welcomeEmail(user.full_name),
    });

    return toAuthResult(user);
}

export async function login(input: LoginInput): Promise<AuthResult> {
    const user = await userModel.findByEmail(input.email);

    // Se compara siempre, exista el usuario o no, para que el tiempo de
    // respuesta sea el mismo en ambos casos.
    const passwordMatches = await bcrypt.compare(
        input.password,
        user?.password_hash ?? DUMMY_HASH
    );

    if (!user || !passwordMatches) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    return toAuthResult(user);
}