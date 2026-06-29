import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
export interface GoogleProfile {
    email: string;
    name: string;
    googleId: string;
}
declare const GoogleStrategy_base: new (...args: [options: import("passport-google-oauth20").StrategyOptionsWithRequest] | [options: import("passport-google-oauth20").StrategyOptions] | [options: import("passport-google-oauth20").StrategyOptions] | [options: import("passport-google-oauth20").StrategyOptionsWithRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class GoogleStrategy extends GoogleStrategy_base {
    constructor();
    validate(_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback): void;
}
export {};
