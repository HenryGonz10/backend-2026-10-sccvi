import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SsoJwtGuard } from './sso-jwt.guard';
import { SsoServiceTokenService } from './sso-service-token.service';

@Global()
@Module({
  providers: [SsoServiceTokenService, SsoJwtGuard, { provide: APP_GUARD, useClass: SsoJwtGuard }],
  exports: [SsoServiceTokenService, SsoJwtGuard],
})
export class AuthModule {}
