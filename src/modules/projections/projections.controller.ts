import { Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { admin, reader, type SccviPrincipal } from '../../shared/auth';
import { ReadProjectionQueryDto } from '../../shared/persistence/dto';
import { SccviService } from '../minors/sccvi.service';
import { SccviReadProjectionService } from './read-projection.service';

@ApiTags('SCCVI') @ApiBearerAuth() @Controller('api/v1')
export class ProjectionsController {
  constructor(private readonly service: SccviService, private readonly readProjection: SccviReadProjectionService) {}
  private p(req: { principal: SccviPrincipal }) { return req.principal; }

  @Get('lecturas/menores') async readMinors(@Query() q: ReadProjectionQueryDto, @Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.readProjection.list({ ...q, ...(await this.service.territoryFor(principal)) }); }
  @Get('busquedas/menores') async searchMinors(@Query() q: ReadProjectionQueryDto, @Req() r: { principal: SccviPrincipal }) { const principal = this.p(r); reader(principal); return this.readProjection.search({ ...q, ...(await this.service.territoryFor(principal)) }); }
  @Post('lecturas/reconstruir') rebuildReads(@Req() r: { principal: SccviPrincipal }) { admin(this.p(r)); return this.readProjection.rebuild(); }
}
