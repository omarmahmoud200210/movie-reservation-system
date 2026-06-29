"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleLinkAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const token_service_1 = require("../token.service");
let GoogleLinkAuthGuard = class GoogleLinkAuthGuard extends (0, passport_1.AuthGuard)('google-link') {
    tokenService;
    constructor(tokenService) {
        super();
        this.tokenService = tokenService;
    }
    getAuthenticateOptions(context) {
        const req = context.switchToHttp().getRequest();
        const user = req.user;
        if (!user)
            return {};
        return { state: this.tokenService.signLinkState(user.id) };
    }
};
exports.GoogleLinkAuthGuard = GoogleLinkAuthGuard;
exports.GoogleLinkAuthGuard = GoogleLinkAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [token_service_1.TokenService])
], GoogleLinkAuthGuard);
//# sourceMappingURL=google-link-auth.guard.js.map