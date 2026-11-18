import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './shared/auth';
import { entities } from './shared/persistence/entities';
import { AlertsModule } from './modules/alerts';
import { CampaignsModule } from './modules/campaigns';
import { GrowthModule } from './modules/growth';
import { IntegrationsModule } from './modules/integrations';
import { MinorsModule } from './modules/minors';
import { ProjectionsModule } from './modules/projections';
import { PublicCardModule } from './modules/public-card';
import { ReportsModule } from './modules/reports';
import { VaccinationModule } from './modules/vaccination';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        type: 'mssql' as const,
        host: c.get<string>('DB_HOST', 'mssql'),
        port: Number(c.get<number>('DB_PORT', 1433)),
        username: c.get<string>('DB_USERNAME', 'sa'),
        password: c.getOrThrow<string>('DB_PASSWORD'),
        database: c.get<string>('DB_DATABASE', 'sccvi-db'),
        options: {
          encrypt: c.get<string>('DB_ENCRYPT', 'no') === 'yes',
          trustServerCertificate: c.get<string>('DB_TRUST_SERVER_CERTIFICATE', 'true') === 'true',
        },
        entities: [...entities],
        synchronize: false,
      }),
    }),
    AuthModule,
    IntegrationsModule,
    ProjectionsModule,
    GrowthModule,
    MinorsModule,
    VaccinationModule,
    CampaignsModule,
    AlertsModule,
    ReportsModule,
    PublicCardModule,
  ],
})
export class AppModule {}
