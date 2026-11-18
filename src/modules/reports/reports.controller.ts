import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { reader, type SccviPrincipal } from '../../shared/auth';
import { PageDto } from '../../shared/persistence/dto';
import { SccviService } from '../minors/sccvi.service';
import { ReportExportService } from './report-export.service';

@ApiTags('SCCVI') @ApiBearerAuth() @Controller('api/v1')
export class ReportsController {
  constructor(private readonly service: SccviService, private readonly exports: ReportExportService) {}
  private p(req: { principal: SccviPrincipal }) { return req.principal; }

  // Read-only operational reports are available to the clinical team; catalog
  // mutations and notification actions remain restricted to administrators.
  @Get('reportes/cobertura') coverage(@Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.service.coverage(principal); }
  @Get('reportes/aplicaciones-territorio') applicationAnalytics(@Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.service.applicationAnalytics(principal); }
  @Get('reportes/crecimiento') growthReport(@Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.service.growthReport(principal); }
  @Get('reportes/exportar') async exportReport(@Query('formato') format: string | undefined, @Req() r: { principal: SccviPrincipal }, @Res() response: Response) { const principal = this.p(r); reader(principal); const file = await this.exports.build(format, principal); response.setHeader('Content-Type', file.mime); response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`); response.send(file.body); }
  @Get('reportes/pendientes') pending(@Query() q: PageDto, @Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.service.pendingReport(q, principal); }
}
