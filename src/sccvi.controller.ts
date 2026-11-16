import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AplicacionDto, DosisDto, EsquemaDto, FamiliaRegistroDto, FamiliaResponsableDto, JornadaDto, JornadaNotificacionDto, MedicionDto, MenorDto, MenorQueryDto, PageDto, PersonaSearchDto, PublicCardPinDto, ReadProjectionQueryDto, ResponsableDto, UpdateEsquemaDto, UpdateJornadaDto, UpdateMenorDto, UpdateResponsableDto, UpdateVacunaDto, VacunaDto, VersionDto } from './dto';
import { SccviReadProjectionService } from './read-projection.service';
import { SccviService } from './sccvi.service';
import { requireScope, SccviPrincipal } from './sso-jwt.guard';
import { Public } from './public.decorator';

const admin = (p: SccviPrincipal) => requireScope(p, 'sccvi.admin', 'sso.admin');
const clinician = (p: SccviPrincipal) => requireScope(p, 'sccvi.clinical', 'sccvi.admin', 'sso.admin');
const reader = (p: SccviPrincipal) => requireScope(p, 'sccvi.read', 'sccvi.clinical', 'sccvi.admin', 'sso.admin');

@ApiTags('SCCVI') @ApiBearerAuth() @Controller('api/v1')
export class SccviController {
  constructor(private readonly service: SccviService, private readonly readProjection: SccviReadProjectionService) {}
  private p(req: { principal: SccviPrincipal }) { return req.principal; }

  @Public() @Get('health') health() { return { status: 'ok' }; }
  @Get('sesion') session(@Req() r: { principal: SccviPrincipal }) { const p = this.p(r); return { user_id: p.userId, persona_id: p.personaId ?? null, scopes: p.scopes, roles: p.roles, permissions: p.permissions }; }
  @Get('personas/buscar') searchPeople(@Query() q: PersonaSearchDto, @Req() r: { principal: SccviPrincipal }) { reader(this.p(r)); return this.service.searchPeople(q); }
  @Get('personas/:personaId/menores') dependents(@Param('personaId') personaId: string, @Req() r: { principal: SccviPrincipal }) { return this.service.dependentsForPerson(personaId, this.p(r)); }
  @Get('personas/:personaId') person(@Param('personaId') personaId: string, @Req() r: { principal: SccviPrincipal }) { return this.service.getPerson(personaId, this.p(r)); }
  @Get('lecturas/menores') async readMinors(@Query() q: ReadProjectionQueryDto, @Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.readProjection.list({ ...q, ...(await this.service.territoryFor(principal)) }); }
  @Get('busquedas/menores') async searchMinors(@Query() q: ReadProjectionQueryDto, @Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.readProjection.search({ ...q, ...(await this.service.territoryFor(principal)) }); }
  @Post('lecturas/reconstruir') rebuildReads(@Req() r: { principal: SccviPrincipal }) { admin(this.p(r)); return this.readProjection.rebuild(); }
  @Get('menores') menores(@Query() q: MenorQueryDto, @Req() r: { principal: SccviPrincipal }) { return this.service.listMenores(q, this.p(r)); }
  @Post('menores') createMenor(@Body() b: MenorDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.createMenor(b, this.p(r)); }
  @Post('familias') createFamily(@Body() b: FamiliaRegistroDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.createFamily(b, this.p(r)); }
  @Get('menores/:id') menor(@Param('id') id: string, @Req() r: { principal: SccviPrincipal }) { return this.service.getMenor(id, this.p(r)); }
  @Patch('menores/:id') updateMenor(@Param('id') id: string, @Body() b: UpdateMenorDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.updateMenor(id, b, this.p(r)); }
  @Get('menores/:id/responsables') responsables(@Param('id') id: string, @Query() q: PageDto, @Req() r: { principal: SccviPrincipal }) { return this.service.listResponsables(id, q, this.p(r)); }
  @Post('menores/:id/responsables/registrar') registerResponsable(@Param('id') id: string, @Body() b: FamiliaResponsableDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.registerResponsable(id, b, this.p(r)); }
  @Post('menores/:id/responsables') addResponsable(@Param('id') id: string, @Body() b: ResponsableDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.createResponsable(id, b, this.p(r)); }
  @Patch('menores/:id/responsables/:relacionId') editResponsable(@Param('id') id: string, @Param('relacionId') rel: string, @Body() b: UpdateResponsableDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.updateResponsable(id, rel, b, this.p(r)); }
  @Delete('menores/:id/responsables/:relacionId') @HttpCode(200) removeResponsable(@Param('id') id: string, @Param('relacionId') rel: string, @Body() b: VersionDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.deleteResponsable(id, rel, b.version, this.p(r)); }
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
  @Public() @Get('public/carnes/:token') publicCardStatus(@Param('token') token: string) { return this.service.publicCardStatus(token); }
  @Public() @Post('public/carnes/:token/consultar') @HttpCode(200) publicCardRead(@Param('token') token: string, @Body() body: PublicCardPinDto) { return this.service.publicCard(token, body.pin); }
  @Post('menores/:id/vacunacion') apply(@Param('id') id: string, @Body() b: AplicacionDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.applyValidatedDose(id, b, this.p(r)); }
  @Get('menores/:id/mediciones') mediciones(@Param('id') id: string, @Query() q: PageDto, @Req() r: { principal: SccviPrincipal }) { return this.service.measurements(id, q, this.p(r)); }
  @Post('menores/:id/mediciones') addMedicion(@Param('id') id: string, @Body() b: MedicionDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.addMeasurement(id, b, this.p(r)); }
  @Get('jornadas') jornadas(@Query() q: PageDto) { return this.service.listJornadas(q); }
  // Clinical teams plan and maintain campaigns; vaccine/scheme catalogues and
  // mass-notification dispatch remain restricted to administrators.
  @Post('jornadas') addJornada(@Body() b: JornadaDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.createJornada(b, this.p(r)); }
  @Patch('jornadas/:id') updateJornada(@Param('id') id: string, @Body() b: UpdateJornadaDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.updateJornada(id, b, this.p(r)); }
  @Post('jornadas/:id/notificar') notifyJornada(@Param('id') id: string, @Body() b: JornadaNotificacionDto, @Req() r: { principal: SccviPrincipal }) { admin(this.p(r)); return this.service.notifyEligibleJornada(id, b, this.p(r)); }
  @Get('menores/:id/alertas') alerts(@Param('id') id: string, @Query() q: PageDto, @Req() r: { principal: SccviPrincipal }) { return this.service.alerts(id, q, this.p(r)); }
  @Post('alertas/recalcular') recalculate(@Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.recalculateAlerts(this.p(r)); }
  // Read-only operational reports are available to the clinical team; catalog
  // mutations and notification actions remain restricted to administrators.
  @Get('reportes/cobertura') coverage(@Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.service.coverage(principal); }
  @Get('reportes/aplicaciones-territorio') applicationAnalytics(@Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.service.applicationAnalytics(principal); }
  @Get('reportes/pendientes') pending(@Query() q: PageDto, @Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.service.pendingReport(q, principal); }
}
