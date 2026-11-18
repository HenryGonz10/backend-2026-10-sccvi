import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { entities } from '../../shared/persistence/entities';
import { GrowthModule } from '../growth/growth.module';
import { ProjectionsModule } from '../projections/projections.module';
import { MinorsController } from './minors.controller';
import { SccviService } from './sccvi.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([...entities]),
    forwardRef(() => ProjectionsModule),
    forwardRef(() => GrowthModule),
  ],
  controllers: [MinorsController],
  providers: [SccviService],
  exports: [SccviService],
})
export class MinorsModule {}
