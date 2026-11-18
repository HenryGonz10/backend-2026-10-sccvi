import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { admin, clinician, type SccviPrincipal } from '../../shared/auth';
import { JornadaDto, JornadaNotificacionDto, PageDto, UpdateJornadaDto } from '../../shared/persistence/dto';
import { SccviService } from '../minors/sccvi.service';

@ApiTags('SCCVI') @ApiBearerAuth() @Controller('api/v1')
export class CampaignsController {
  constructor(private readonly service: SccviService) {}
  private p(req: { principal: SccviPrincipal }) { return req.principal; }

  @Get('jornadas') jornadas(@Query() q: PageDto) { return this.service.listJornadas(q); }
  // Clinical teams plan and maintain campaigns; vaccine/scheme catalogues and
  // mass-notification dispatch remain restricted to administrators.
  @Post('jornadas') addJornada(@Body() b: JornadaDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.createJornada(b, this.p(r)); }
  @Patch('jornadas/:id') updateJornada(@Param('id') id: string, @Body() b: UpdateJornadaDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.updateJornada(id, b, this.p(r)); }
  @Post('jornadas/:id/notificar') notifyJornada(@Param('id') id: string, @Body() b: JornadaNotificacionDto, @Req() r: { principal: SccviPrincipal }) { admin(this.p(r)); return this.service.notifyEligibleJornada(id, b, this.p(r)); }
}
