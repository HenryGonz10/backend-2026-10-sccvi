import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { admin, clinician, type SccviPrincipal } from '../../shared/auth';
import { AplicacionDto, DosisDto, EsquemaDto, PageDto, UpdateEsquemaDto, UpdateVacunaDto, VacunaDto } from '../../shared/persistence/dto';
import { SccviService } from '../minors/sccvi.service';

@ApiTags('SCCVI') @ApiBearerAuth() @Controller('api/v1')
export class VaccinationController {
  constructor(private readonly service: SccviService) {}
  private p(req: { principal: SccviPrincipal }) { return req.principal; }

  @Get('vacunas') vacunas(@Query() q: PageDto) { return this.service.listVacunas(q); }
  @Post('vacunas') createVacuna(@Body() b: VacunaDto, @Req() r: { principal: SccviPrincipal }) { admin(this.p(r)); return this.service.createVacuna(b, this.p(r)); }
  @Patch('vacunas/:id') updateVacuna(@Param('id') id: string, @Body() b: UpdateVacunaDto, @Req() r: { principal: SccviPrincipal }) { admin(this.p(r)); return this.service.updateVacuna(id, b, this.p(r)); }
  @Get('esquemas') esquemas(@Query() q: PageDto) { return this.service.listEsquemas(q); }
  @Post('esquemas') createEsquema(@Body() b: EsquemaDto, @Req() r: { principal: SccviPrincipal }) { admin(this.p(r)); return this.service.createEsquema(b, this.p(r)); }
  @Patch('esquemas/:id') updateEsquema(@Param('id') id: string, @Body() b: UpdateEsquemaDto, @Req() r: { principal: SccviPrincipal }) { admin(this.p(r)); return this.service.updateEsquema(id, b, this.p(r)); }
  @Post('esquemas/:id/dosis') addDosis(@Param('id') id: string, @Body() b: DosisDto, @Req() r: { principal: SccviPrincipal }) { admin(this.p(r)); return this.service.addDosis(id, b, this.p(r)); }
  @Get('menores/:id/vacunacion') vacunacion(@Param('id') id: string, @Query() q: PageDto, @Req() r: { principal: SccviPrincipal }) { return this.service.vaccination(id, q, this.p(r)); }
  @Get('menores/:id/carne-vacunacion') carne(@Param('id') id: string, @Req() r: { principal: SccviPrincipal }) { return this.service.vaccinationCard(id, this.p(r)); }
  @Post('menores/:id/carne-publico') publicCard(@Param('id') id: string, @Req() r: { principal: SccviPrincipal }) { return this.service.createPublicCard(id, this.p(r)); }
  @Delete('menores/:id/carne-publico/:token') @HttpCode(200) revokePublicCard(@Param('id') id: string, @Param('token') token: string, @Req() r: { principal: SccviPrincipal }) { return this.service.revokePublicCard(id, token, this.p(r)); }
  @Post('menores/:id/vacunacion') apply(@Param('id') id: string, @Body() b: AplicacionDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.applyValidatedDose(id, b, this.p(r)); }
}
