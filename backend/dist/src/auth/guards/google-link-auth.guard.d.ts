import { ExecutionContext } from '@nestjs/common';
import { TokenService } from '../token.service';
declare const GoogleLinkAuthGuard_base: import("@nestjs/passport").Type<import("@nestjs/passport").IAuthGuard>;
export declare class GoogleLinkAuthGuard extends GoogleLinkAuthGuard_base {
    private readonly tokenService;
    constructor(tokenService: TokenService);
    getAuthenticateOptions(context: ExecutionContext): {
        state?: string;
    };
}
export {};
