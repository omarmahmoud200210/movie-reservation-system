import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User } from '@prisma/client';
export declare class AuthRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findByEmail(email: string): Promise<User | null>;
    findById(id: number): Promise<User | null>;
    findByGoogleId(googleId: string): Promise<User | null>;
    createUser(data: Prisma.UserCreateInput): Promise<User>;
    createGoogleUser(data: {
        name: string;
        email: string;
        googleId: string;
    }): Promise<User>;
    setGoogleId(userId: number, googleId: string): Promise<User>;
    markEmailVerified(id: number): Promise<User>;
}
