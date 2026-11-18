import { UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { ApiResponseInterceptor } from './http/api-response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const trustedProxies = (process.env.TRUSTED_PROXY_CIDRS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  // Do not accept arbitrary X-Forwarded-For values on direct requests.
  (app.getHttpAdapter().getInstance() as { set: (key: string, value: string[] | boolean) => void }).set('trust proxy', trustedProxies.length ? trustedProxies : false);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, exceptionFactory: errors => new UnprocessableEntityException(errors) }));
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean), credentials: true });
  SwaggerModule.setup('api/documentation', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('SCCVI').setDescription('Control de vacunación infantil de Guatemala. Las respuestas JSON usan `{ valid, data, msg }`; las colecciones agregan `meta` para paginación. Errores: 401 sin sesión, 403 sin permiso, 404 sin revelar menores ajenos, 409 por versión y 422 por validación. Las descargas PDF/XLSX son binarias y conservan la misma autorización territorial.').setVersion('v1').addBearerAuth().build()));
  await app.listen(Number(process.env.PORT ?? 8200), '0.0.0.0');
}
void bootstrap();
