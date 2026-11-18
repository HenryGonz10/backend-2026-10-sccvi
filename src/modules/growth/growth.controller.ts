import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { clinician, type SccviPrincipal } from '../../shared/auth';
import { CorreccionMedicionDto, MedicionDto, PageDto } from '../../shared/persistence/dto';
import { SccviService } from '../minors/sccvi.service';

@ApiTags('SCCVI') @ApiBearerAuth() @Controller('api/v1')
export class GrowthController {
  constructor(private readonly service: SccviService) {}
  private p(req: { principal: SccviPrincipal }) { return req.principal; }

  @Get('menores/:id/mediciones') mediciones(@Param('id') id: string, @Query() q: PageDto, @Req() r: { principal: SccviPrincipal }) { return this.service.measurements(id, q, this.p(r)); }
  @Get('menores/:id/crecimiento/curvas') growthCurves(@Param('id') id: string, @Query('sexo_curva_evaluacion') curveOverride: string | undefined, @Req() r: { principal: SccviPrincipal }) { return curveOverride ? this.service.growthCurves(id, this.p(r), curveOverride) : this.service.growthCurves(id, this.p(r)); }
  @Post('menores/:id/mediciones') addMedicion(@Param('id') id: string, @Body() b: MedicionDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.addMeasurement(id, b, this.p(r)); }
  @Post('menores/:id/mediciones/:medicionId/correccion') correctMedicion(@Param('id') id: string, @Param('medicionId') medicionId: string, @Body() b: CorreccionMedicionDto, @Req() r: { principal: SccviPrincipal }) { clinician(this.p(r)); return this.service.correctMeasurement(id, medicionId, b, this.p(r)); }
}
