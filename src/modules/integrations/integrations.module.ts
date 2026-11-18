import { Global, Module } from '@nestjs/common';
import { GeoClient, NotificationsClient, SsoClient } from './integrations';

@Global()
@Module({
  providers: [SsoClient, GeoClient, NotificationsClient],
  exports: [SsoClient, GeoClient, NotificationsClient],
})
export class IntegrationsModule {}
