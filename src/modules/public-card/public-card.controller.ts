import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../shared/auth';
import { PublicCardPinDto } from '../../shared/persistence/dto';
import { SccviService } from '../minors/sccvi.service';
import { PublicCardRateLimitGuard } from './public-card-rate-limit.guard';

@ApiTags('SCCVI') @Controller('api/v1')
export class PublicCardController {
  constructor(private readonly service: SccviService) {}

  @Public() @UseGuards(PublicCardRateLimitGuard) @Get('public/carnes/:token') publicCardStatus(@Param('token') token: string) { return this.service.publicCardStatus(token); }
  @Public() @UseGuards(PublicCardRateLimitGuard) @Post('public/carnes/:token/consultar') @HttpCode(200) publicCardRead(@Param('token') token: string, @Body() body: PublicCardPinDto) { return this.service.publicCard(token, body.pin); }
}
