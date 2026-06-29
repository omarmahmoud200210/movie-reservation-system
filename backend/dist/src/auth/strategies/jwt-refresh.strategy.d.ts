import { Strategy } from 'passport-jwt';
import type { RefreshPayload } from '../token.service';
export interface RefreshUser {
    id: number;
    jti: string;
}
declare const JwtRefreshStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtRefreshStrategy extends JwtRefreshStrategy_base {
    constructor();
    validate(payload: RefreshPayload): RefreshUser;
}
export {};
