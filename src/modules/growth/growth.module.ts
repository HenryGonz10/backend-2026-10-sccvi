import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { entities } from '../../shared/persistence/entities';
import { MinorsModule } from '../minors/minors.module';
import { ProjectionsModule } from '../projections/projections.module';
import { GrowthController } from './growth.controller';
import { GrowthService } from './growth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([...entities]),
    ProjectionsModule,
    forwardRef(() => MinorsModule),
  ],
  controllers: [GrowthController],
  providers: [GrowthService],
  exports: [GrowthService],
})
export class GrowthModule {}
