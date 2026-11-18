import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { clinician, type SccviPrincipal } from '../../shared/auth';
import { PageDto } from '../../shared/persistence/dto';
import { SccviService } from '../minors/sccvi.service';

@ApiTags('SCCVI') @ApiBearerAuth() @Controller('api/v1')
export class AlertsController {
  constructor(private readonly service: SccviService) {}
  private p(req: { principal: SccviPrincipal }) { return req.principal; }

  @Get('menores/:id/alertas') alerts(@Param('id') id: string, @Query() q: PageDto, @Req() r: { principal: SccviPrincipal }) { return this.service.alerts(id, q, this.p(r)); }
  @Get('menores/:id/alertas-crecimiento') growthAlerts(@Param('id') id: string, @Req() r: { principal: SccviPrincipal }) { return this.service.growthAlerts(id, this.p(r)); }
  @Post('alertas/recalcular') recalculate(@Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.recalculateAlerts(this.p(r)); }
}
