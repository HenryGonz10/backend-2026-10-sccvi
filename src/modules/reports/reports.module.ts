import { Module } from '@nestjs/common';
import { MinorsModule } from '../minors/minors.module';
import { ReportExportService } from './report-export.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [MinorsModule],
  controllers: [ReportsController],
  providers: [ReportExportService],
  exports: [ReportExportService],
})
export class ReportsModule {}
