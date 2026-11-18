import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { clinician, Public, reader, type SccviPrincipal } from '../../shared/auth';
import { FamiliaRegistroDto, FamiliaResponsableDto, MenorDto, MenorQueryDto, PageDto, PersonaSearchDto, ResponsableDto, UpdateMenorDto, UpdateResponsableDto, VersionDto } from '../../shared/persistence/dto';
import { SccviService } from './sccvi.service';

@ApiTags('SCCVI') @ApiBearerAuth() @Controller('api/v1')
export class MinorsController {
  constructor(private readonly service: SccviService) {}
  private p(req: { principal: SccviPrincipal }) { return req.principal; }

  @Public() @Get('health') async health() { if (typeof this.service.clinicalReadiness !== 'function') return { status: 'ok' }; const clinical = await this.service.clinicalReadiness(); return { status: clinical.ready ? 'ok' : 'degraded', clinical_growth: clinical }; }
  @Get('sesion') session(@Req() r: { principal: SccviPrincipal }) { const p = this.p(r); return { user_id: p.userId, persona_id: p.personaId ?? null, scopes: p.scopes, roles: p.roles, permissions: p.permissions, territorio: p.territory ?? null, unidad: p.organizationUnit ?? null }; }
  @Get('personas/buscar') searchPeople(@Query() q: PersonaSearchDto, @Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.service.searchPeople(q, principal); }
  @Get('personas/:personaId/menores') dependents(@Param('personaId') personaId: string, @Req() r: { principal: SccviPrincipal }) { return this.service.dependentsForPerson(personaId, this.p(r)); }
  @Get('personas/:personaId') person(@Param('personaId') personaId: string, @Req() r: { principal: SccviPrincipal }) { return this.service.getPerson(personaId, this.p(r)); }
  @Get('menores') menores(@Query() q: MenorQueryDto, @Req() r: { principal: SccviPrincipal }) { return this.service.listMenores(q, this.p(r)); }
  @Get('menores/persona/:personaId') existingMenor(@Param('personaId') personaId: string, @Req() r: { principal: SccviPrincipal }) { return this.service.existingMenorByPersona(personaId, this.p(r)); }
  @Post('menores') createMenor(@Body() b: MenorDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.createMenor(b, this.p(r)); }
  @Post('familias') createFamily(@Body() b: FamiliaRegistroDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.createFamily(b, this.p(r)); }
  @Get('menores/:id') menor(@Param('id') id: string, @Req() r: { principal: SccviPrincipal }) { return this.service.getMenor(id, this.p(r)); }
  @Patch('menores/:id') updateMenor(@Param('id') id: string, @Body() b: UpdateMenorDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.updateMenor(id, b, this.p(r)); }
  @Get('menores/:id/responsables') responsables(@Param('id') id: string, @Query() q: PageDto, @Req() r: { principal: SccviPrincipal }) { return this.service.listResponsables(id, q, this.p(r)); }
  @Post('menores/:id/responsables/registrar') registerResponsable(@Param('id') id: string, @Body() b: FamiliaResponsableDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.registerResponsable(id, b, this.p(r)); }
  @Post('menores/:id/responsables') addResponsable(@Param('id') id: string, @Body() b: ResponsableDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.createResponsable(id, b, this.p(r)); }
  @Patch('menores/:id/responsables/:relacionId') editResponsable(@Param('id') id: string, @Param('relacionId') rel: string, @Body() b: UpdateResponsableDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.updateResponsable(id, rel, b, this.p(r)); }
  @Delete('menores/:id/responsables/:relacionId') @HttpCode(200) removeResponsable(@Param('id') id: string, @Param('relacionId') rel: string, @Body() b: VersionDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.deleteResponsable(id, rel, b.version, this.p(r)); }
}
