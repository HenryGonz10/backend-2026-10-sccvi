import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { entities } from '../../shared/persistence/entities';
import { MinorsModule } from '../minors/minors.module';
import { OutboxService } from './outbox.service';
import { ProjectionOutboxService } from './projection-outbox.service';
import { ProjectionsController } from './projections.controller';
import { SccviReadProjectionService } from './read-projection.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([...entities]),
    forwardRef(() => MinorsModule),
  ],
  controllers: [ProjectionsController],
  providers: [OutboxService, SccviReadProjectionService, ProjectionOutboxService],
  exports: [OutboxService, SccviReadProjectionService, ProjectionOutboxService],
})
export class ProjectionsModule {}
