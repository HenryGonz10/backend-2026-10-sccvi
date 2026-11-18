import { Module } from '@nestjs/common';
import { MinorsModule } from '../minors/minors.module';
import { VaccinationController } from './vaccination.controller';

@Module({
  imports: [MinorsModule],
  controllers: [VaccinationController],
})
export class VaccinationModule {}
