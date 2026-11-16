import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { entities } from './entities';
import { GeoClient, NotificationsClient, SsoClient } from './integrations';
import { OutboxService } from './outbox.service';
import { SccviController } from './sccvi.controller';
import { SccviService } from './sccvi.service';
import { SsoJwtGuard } from './sso-jwt.guard';
import { SccviReadProjectionService } from './read-projection.service';
import { ProjectionOutboxService } from './projection-outbox.service';
import { SsoServiceTokenService } from './sso-service-token.service';
import { CampaignReminderService } from './campaign-reminder.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), TypeOrmModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (c: ConfigService) => ({ type: 'mssql' as const, host: c.get<string>('DB_HOST', 'mssql'), port: Number(c.get<number>('DB_PORT', 1433)), username: c.get<string>('DB_USERNAME', 'sa'), password: c.getOrThrow<string>('DB_PASSWORD'), database: c.get<string>('DB_DATABASE', 'sccvi-db'), options: { encrypt: c.get<string>('DB_ENCRYPT', 'no') === 'yes', trustServerCertificate: c.get<string>('DB_TRUST_SERVER_CERTIFICATE', 'true') === 'true' }, entities: [...entities], synchronize: false,
    }),
  }), TypeOrmModule.forFeature([...entities])],
  controllers: [SccviController],
  providers: [SccviService, SsoClient, GeoClient, NotificationsClient, OutboxService, SccviReadProjectionService, ProjectionOutboxService, SsoServiceTokenService, CampaignReminderService, { provide: APP_GUARD, useClass: SsoJwtGuard }],
})
export class AppModule {}
