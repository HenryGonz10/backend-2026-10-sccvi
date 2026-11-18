import { Module } from '@nestjs/common';
import { MinorsModule } from '../minors/minors.module';
import { PublicCardController } from './public-card.controller';
import { PublicCardRateLimitGuard } from './public-card-rate-limit.guard';

@Module({
  imports: [MinorsModule],
  controllers: [PublicCardController],
  providers: [PublicCardRateLimitGuard],
  exports: [PublicCardRateLimitGuard],
})
export class PublicCardModule {}
