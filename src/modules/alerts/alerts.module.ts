import { Module } from '@nestjs/common';
import { MinorsModule } from '../minors/minors.module';
import { AlertsController } from './alerts.controller';

@Module({
  imports: [MinorsModule],
  controllers: [AlertsController],
})
export class AlertsModule {}
