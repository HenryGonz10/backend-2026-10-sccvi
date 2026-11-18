import { Module } from '@nestjs/common';
import { MinorsModule } from '../minors/minors.module';
import { CampaignReminderService } from './campaign-reminder.service';
import { CampaignsController } from './campaigns.controller';

@Module({
  imports: [MinorsModule],
  controllers: [CampaignsController],
  providers: [CampaignReminderService],
})
export class CampaignsModule {}
