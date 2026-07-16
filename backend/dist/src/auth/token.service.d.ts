import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import RedisCache from '../redis/redis.cache';
export interface AuthUser {
    id: number;
    name: string;
    email: string;
    role: string;
}
interface AccessPayload {
    sub: number;
    name: string;
    email: string;
    role: string;
    ver: number;
}
interface RefreshPayload {
    sub: number;
    jti: string;
}
export declare class TokenService {
    private readonly jwt;
    private readonly redis;
    constructor(jwt: JwtService, redis: RedisCache);
    private signAccess;
    private signRefresh;
    private refreshKey;
    issueAuthCookies(res: Response, user: AuthUser): Promise<void>;
    rotateAuthCookies(res: Response, payload: {
        id: number;
        jti: string;
    }, user: AuthUser): Promise<void>;
    private accessVersionKey;
    incrementAccessVersion(userId: number): Promise<void>;
    getAccessVersion(userId: number): Promise<number>;
    signLinkState(userId: number): string;
    verifyLinkState(token: string | undefined): {
        id: number;
    };
    setAuthCookies(res: Response, access: string, refresh: string): void;
    clearAuthCookies(res: Response): void;
    revokeAllSessions(userId: number): Promise<void>;
}
export type { AccessPayload, RefreshPayload };
