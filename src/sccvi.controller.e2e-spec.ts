import { CanActivate, ExecutionContext, Injectable, NotFoundException, ConflictException, UnauthorizedException, UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { ApiResponseInterceptor } from './http/api-response.interceptor';
import { SccviController } from './sccvi.controller';
import { SccviService } from './sccvi.service';
import { SccviReadProjectionService } from './read-projection.service';
import { IS_PUBLIC } from './public.decorator';

@Injectable()
class HeaderPrincipalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (Reflect.getMetadata(IS_PUBLIC, context.getHandler())) return true;
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; principal?: unknown }>();
    const auth = req.headers.authorization;
    if (!auth) throw new UnauthorizedException('Sesión requerida.');
    const scopes = auth === 'Bearer admin' ? ['sccvi.admin'] : auth === 'Bearer clinical' ? ['sccvi.clinical'] : [];
    const roles = auth === 'Bearer consult' ? ['SCCVI_CONSULTA'] : [];
    req.principal = { userId: '1', personaId: '10', scopes, roles, payload: { sub: '1' } };
    return true;
  }
}

describe('SCCVI HTTP contract', () => {
  let app: INestApplication;
  const page = { items: [], meta: { current_page: 1, per_page: 25, total: 0, last_page: 1 } };
  const service = {
    listMenores: jest.fn(), createMenor: jest.fn(), createFamily: jest.fn(), getMenor: jest.fn(), updateMenor: jest.fn(), listResponsables: jest.fn(), registerResponsable: jest.fn(), createResponsable: jest.fn(), updateResponsable: jest.fn(), deleteResponsable: jest.fn(), listVacunas: jest.fn(), createVacuna: jest.fn(), updateVacuna: jest.fn(), listEsquemas: jest.fn(), createEsquema: jest.fn(), updateEsquema: jest.fn(), addDosis: jest.fn(), vaccination: jest.fn(), vaccinationCard: jest.fn(), createPublicCard: jest.fn(), publicCardStatus: jest.fn(), publicCard: jest.fn(), revokePublicCard: jest.fn(), applyValidatedDose: jest.fn(), measurements: jest.fn(), addMeasurement: jest.fn(), listJornadas: jest.fn(), createJornada: jest.fn(), updateJornada: jest.fn(), alerts: jest.fn(), recalculateAlerts: jest.fn(), coverage: jest.fn(), pendingReport: jest.fn(), searchPeople: jest.fn(), getPerson: jest.fn(), dependentsForPerson: jest.fn(), territoryFor: jest.fn(),
  };
  const readProjection = { list: jest.fn(), search: jest.fn(), rebuild: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [SccviController], providers: [{ provide: SccviService, useValue: service }, { provide: SccviReadProjectionService, useValue: readProjection }, { provide: APP_GUARD, useClass: HeaderPrincipalGuard }] }).compile();
    app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, exceptionFactory: errors => new UnprocessableEntityException(errors) })); app.useGlobalInterceptors(new ApiResponseInterceptor()); app.useGlobalFilters(new ApiExceptionFilter()); await app.init(); app.getHttpServer().setMaxListeners(50);
  });
  afterAll(async () => app.close());
  beforeEach(() => { jest.resetAllMocks(); Object.values(service).forEach(mock => (mock as jest.Mock).mockResolvedValue(page)); readProjection.list.mockResolvedValue(page); readProjection.search.mockResolvedValue(page); readProjection.rebuild.mockResolvedValue(0); });
  const assertEnvelope = (body: unknown) => { expect(body).toEqual(expect.objectContaining({ valid: expect.any(Boolean), msg: expect.any(String) })); expect(Object.prototype.hasOwnProperty.call(body, 'data')).toBe(true); };

  it('returns 401 envelope without an SSO session', async () => { const response = await request(app.getHttpServer()).get('/api/v1/menores'); expect(response.status).toBe(401); assertEnvelope(response.body); expect(response.body).toMatchObject({ valid: false, data: null, code: 'UNAUTHORIZED' }); });
  it('keeps the container health endpoint public and enveloped', async () => { const response = await request(app.getHttpServer()).get('/api/v1/health'); expect(response.status).toBe(200); expect(response.body).toEqual({ valid: true, data: { status: 'ok' }, msg: 'Operación completada.' }); });
  it('returns stable pagination metadata for an empty citizen list', async () => { service.listMenores.mockResolvedValue(page); const response = await request(app.getHttpServer()).get('/api/v1/menores').set('Authorization', 'Bearer citizen'); expect(response.status).toBe(200); expect(response.body).toEqual({ valid: true, data: [], msg: 'Operación completada.', meta: page.meta }); });
  it('keeps a partial CUI, name, or birth-date search inside the clinician territory', async () => { service.territoryFor.mockResolvedValue({ departamento_codigo: '16', municipio_codigo: '1601' }); const response = await request(app.getHttpServer()).get('/api/v1/busquedas/menores?q=mar&cui=900000000000&fecha_nacimiento=2025-03-12').set('Authorization', 'Bearer clinical'); expect(response.status).toBe(200); expect(readProjection.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'mar', cui: '900000000000', fecha_nacimiento: '2025-03-12', departamento_codigo: '16', municipio_codigo: '1601' })); });
  it('rejects a citizen clinical mutation with 403 envelope', async () => { const response = await request(app.getHttpServer()).post('/api/v1/menores').set('Authorization', 'Bearer citizen').send({ persona_id: '100' }); expect(response.status).toBe(403); expect(response.body).toMatchObject({ valid: false, data: null, code: 'FORBIDDEN' }); });
  it('returns 422 envelope for invalid clinical input', async () => { const response = await request(app.getHttpServer()).post('/api/v1/menores').set('Authorization', 'Bearer clinical').send({ persona_id: 'not-bigint' }); expect(response.status).toBe(422); expect(response.body).toMatchObject({ valid: false, data: null, code: 'VALIDATION_ERROR' }); });
  it('requires at least one responsible adult when registering a family', async () => { const response = await request(app.getHttpServer()).post('/api/v1/familias').set('Authorization', 'Bearer clinical').send({ menor: { cui: '1234567890123', primer_nombre: 'Ana', primer_apellido: 'Pérez', fecha_nacimiento: '2024-01-01', sexo: 'FEMENINO' }, responsables: [] }); expect(response.status).toBe(422); expect(response.body).toMatchObject({ valid: false, data: null, code: 'VALIDATION_ERROR' }); expect(service.createFamily).not.toHaveBeenCalled(); });
  it('maps 404, 409 and 500 failures to business envelopes', async () => { service.getMenor.mockRejectedValueOnce(new NotFoundException('Menor no encontrado.')); service.updateMenor.mockRejectedValueOnce(new ConflictException('Versión obsoleta.')); service.coverage.mockRejectedValueOnce(new Error('internal detail')); const missing = await request(app.getHttpServer()).get('/api/v1/menores/99').set('Authorization', 'Bearer citizen'); const conflict = await request(app.getHttpServer()).patch('/api/v1/menores/99').set('Authorization', 'Bearer clinical').send({ version: 1, observaciones: 'x' }); const error = await request(app.getHttpServer()).get('/api/v1/reportes/cobertura').set('Authorization', 'Bearer admin'); expect(missing.body).toMatchObject({ valid: false, data: null, code: 'NOT_FOUND' }); expect(conflict.body).toMatchObject({ valid: false, data: null, code: 'CONFLICT' }); expect(error.body).toMatchObject({ valid: false, data: null, code: 'INTERNAL_ERROR', msg: 'Error interno del servicio.' }); });
  it('envelopes DELETE with data null', async () => { service.deleteResponsable.mockResolvedValue(null); const response = await request(app.getHttpServer()).delete('/api/v1/menores/1/responsables/2').set('Authorization', 'Bearer clinical').send({ version: 1 }); expect(response.status).toBe(200); expect(response.body).toEqual({ valid: true, data: null, msg: 'Operación completada.' }); });
  it('requires a PIN before returning a public vaccination card', async () => { service.publicCardStatus.mockResolvedValue({ requiere_pin: true, expira_at: null }); service.publicCard.mockResolvedValue({ menor: { nombre: 'Ana' }, esquema: { codigo: 'PAI-2026' }, ultimo_control: null, dosis: [] }); const status = await request(app.getHttpServer()).get('/api/v1/public/carnes/opaque-token'); const response = await request(app.getHttpServer()).post('/api/v1/public/carnes/opaque-token/consultar').send({ pin: '123456' }); expect(status.body).toEqual({ valid: true, data: { requiere_pin: true, expira_at: null }, msg: 'Operación completada.' }); expect(response.status).toBe(200); expect(response.body).toEqual({ valid: true, data: { menor: { nombre: 'Ana' }, esquema: { codigo: 'PAI-2026' }, ultimo_control: null, dosis: [] }, msg: 'Operación completada.' }); expect(service.publicCard).toHaveBeenCalledWith('opaque-token', '123456'); });
  it('allows the clinical role to read operational reports without granting catalog administration', async () => { const coverage = await request(app.getHttpServer()).get('/api/v1/reportes/cobertura').set('Authorization', 'Bearer clinical'); const pending = await request(app.getHttpServer()).get('/api/v1/reportes/pendientes').set('Authorization', 'Bearer clinical'); expect(coverage.status).toBe(200); expect(pending.status).toBe(200); assertEnvelope(coverage.body); assertEnvelope(pending.body); });
  it('permits consultation roles to read reports but not create a jornada', async () => { const report = await request(app.getHttpServer()).get('/api/v1/reportes/cobertura').set('Authorization', 'Bearer consult'); const mutation = await request(app.getHttpServer()).post('/api/v1/jornadas').set('Authorization', 'Bearer consult').send({ nombre: 'No autorizado', fecha_inicio: '2026-01-01', fecha_fin: '2026-01-02' }); expect(report.status).toBe(200); assertEnvelope(report.body); expect(mutation.status).toBe(403); expect(mutation.body).toMatchObject({ valid: false, code: 'FORBIDDEN' }); });
  it('does not cache successful or unauthorized business envelopes', async () => {
    const anonymous = await request(app.getHttpServer()).get('/api/v1/menores');
    const authenticated = await request(app.getHttpServer()).get('/api/v1/menores').set('Authorization', 'Bearer clinical');
    for (const response of [anonymous, authenticated]) {
      expect(response.headers['cache-control']).toBe('no-store, private');
      expect(response.headers.pragma).toBe('no-cache');
    }
  });
  it('keeps the contract envelope on every required SCCVI business route', async () => {
    const clinical = 'Bearer clinical'; const admin = 'Bearer admin';
    const calls = [
      request(app.getHttpServer()).get('/api/v1/menores/1').set('Authorization', clinical),
      request(app.getHttpServer()).get('/api/v1/personas/100').set('Authorization', clinical),
      request(app.getHttpServer()).get('/api/v1/personas/100/menores').set('Authorization', clinical),
      request(app.getHttpServer()).post('/api/v1/menores').set('Authorization', clinical).send({ persona_id: '100' }),
      request(app.getHttpServer()).post('/api/v1/familias').set('Authorization', clinical).send({ menor: { cui: '1234567890123', primer_nombre: 'Ana', primer_apellido: 'Pérez', fecha_nacimiento: '2024-01-01', sexo: 'FEMENINO' }, responsables: [{ cui: '9876543210123', primer_nombre: 'María', primer_apellido: 'Pérez', fecha_nacimiento: '1994-01-01', sexo: 'FEMENINO', tipo_relacion: 'MADRE' }] }),
      request(app.getHttpServer()).patch('/api/v1/menores/1').set('Authorization', clinical).send({ version: 1 }),
      request(app.getHttpServer()).get('/api/v1/lecturas/menores').set('Authorization', clinical),
      request(app.getHttpServer()).get('/api/v1/busquedas/menores?q=pendiente').set('Authorization', clinical),
      request(app.getHttpServer()).post('/api/v1/lecturas/reconstruir').set('Authorization', admin),
      request(app.getHttpServer()).get('/api/v1/menores/1/responsables').set('Authorization', clinical),
      request(app.getHttpServer()).post('/api/v1/menores/1/responsables/registrar').set('Authorization', clinical).send({ cui: '1234567890123', primer_nombre: 'Ana', primer_apellido: 'Perez', fecha_nacimiento: '1990-01-01', sexo: 'FEMENINO', tipo_relacion: 'MADRE' }),
      request(app.getHttpServer()).post('/api/v1/menores/1/responsables').set('Authorization', clinical).send({ persona_id: '101', tipo_relacion: 'MADRE', fecha_inicio: '2026-01-01' }),
      request(app.getHttpServer()).patch('/api/v1/menores/1/responsables/2').set('Authorization', clinical).send({ version: 1, tipo_relacion: 'PADRE' }),
      request(app.getHttpServer()).get('/api/v1/vacunas').set('Authorization', clinical),
      request(app.getHttpServer()).post('/api/v1/vacunas').set('Authorization', admin).send({ codigo: 'BCG', nombre: 'BCG' }),
      request(app.getHttpServer()).patch('/api/v1/vacunas/1').set('Authorization', admin).send({ version: 1, nombre: 'BCG actualizada' }),
      request(app.getHttpServer()).get('/api/v1/esquemas').set('Authorization', clinical),
      request(app.getHttpServer()).post('/api/v1/esquemas').set('Authorization', admin).send({ codigo: 'PAI-GT', nombre: 'PAI Guatemala', vigencia_desde: '2026-01-01' }),
      request(app.getHttpServer()).patch('/api/v1/esquemas/1').set('Authorization', admin).send({ version: 1, nombre: 'PAI actualizado' }),
      request(app.getHttpServer()).post('/api/v1/esquemas/1/dosis').set('Authorization', admin).send({ vacuna_id: '1', orden: 1, edad_minima_dias: 0 }),
      request(app.getHttpServer()).get('/api/v1/menores/1/vacunacion').set('Authorization', clinical),
      request(app.getHttpServer()).post('/api/v1/menores/1/vacunacion').set('Authorization', clinical).send({ esquema_dosis_id: '1', fecha_aplicacion: '2026-01-01' }),
      request(app.getHttpServer()).get('/api/v1/menores/1/mediciones').set('Authorization', clinical),
      request(app.getHttpServer()).post('/api/v1/menores/1/mediciones').set('Authorization', clinical).send({ fecha: '2026-01-01', peso_kg: 10, talla_cm: 80 }),
      request(app.getHttpServer()).get('/api/v1/jornadas').set('Authorization', clinical),
      request(app.getHttpServer()).post('/api/v1/jornadas').set('Authorization', clinical).send({ nombre: 'Jornada', fecha_inicio: '2026-01-01', fecha_fin: '2026-01-02' }),
      request(app.getHttpServer()).patch('/api/v1/jornadas/1').set('Authorization', clinical).send({ version: 1, nombre: 'Jornada actualizada' }),
      request(app.getHttpServer()).get('/api/v1/menores/1/alertas').set('Authorization', clinical),
      request(app.getHttpServer()).post('/api/v1/alertas/recalcular').set('Authorization', clinical),
      request(app.getHttpServer()).get('/api/v1/reportes/cobertura').set('Authorization', admin),
      request(app.getHttpServer()).get('/api/v1/reportes/pendientes').set('Authorization', admin),
    ];
    for (const response of await Promise.all(calls)) { expect([200, 201]).toContain(response.status); assertEnvelope(response.body); }
  });
});
