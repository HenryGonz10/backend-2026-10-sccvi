import { GrowthService } from './growth.service';

describe('GrowthService', () => {
  const repo = () => ({ findOne: jest.fn(), find: jest.fn(), exist: jest.fn(), create: jest.fn(value => value), save: jest.fn() });
  it('persists reproducible OMS evidence and queues one alert per responsible without contacts', async () => {
    const standards = repo(); const parameters = repo(); const evaluations = repo(); const alerts = repo(); const responsables = repo(); const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const service = new GrowthService(standards as any, parameters as any, evaluations as any, alerts as any, repo() as any, responsables as any, outbox as any);
    standards.findOne.mockResolvedValue({ id: '1', codigo: 'WHO-CGS-2006-0-5', sha256_datos: 'a'.repeat(64), edad_minima_dias: 0, edad_maxima_dias: 1856 });
    parameters.find.mockImplementation(async ({ where }: any) => where.indicador === 'PESO_EDAD' ? [{ x: '0', l: '.3487', m: '3.3464', s: '.14602' }] : []);
    evaluations.save.mockImplementation(async value => ({ ...value, id: `e-${value.indicador}` })); alerts.save.mockImplementation(async value => ({ ...value, id: 'a-1' })); alerts.exist.mockResolvedValue(false); responsables.find.mockResolvedValue([{ persona_id: '77' }, { persona_id: '77' }]);
    const result = await service.evaluate({ id: '9', menor_id: '4', fecha: '2026-01-01', peso_kg: '2.50', talla_cm: '50.00', imc: '10.00', tipo_medicion: 'LONGITUD' } as any, { fecha_nacimiento: '2026-01-01', sexo: 'MASCULINO' }, { personaId: '8' });
    expect(result.standard).toEqual({ codigo: 'WHO-CGS-2006-0-5', sha256_datos: 'a'.repeat(64) });
    expect(evaluations.save).toHaveBeenCalledWith(expect.objectContaining({ indicador: 'PESO_EDAD', edad_dias: 0, sexo_curva: 'MASCULINO', clasificacion: 'BAJO_P5', puntuacion_z: expect.any(String) }));
    expect(outbox.enqueue).toHaveBeenCalledTimes(1); expect(outbox.enqueue).toHaveBeenCalledWith('77', '4', 'SCCVI_ALERTA_CRECIMIENTO', expect.objectContaining({ alerta_id: 'a-1' }), 'crecimiento:a-1:persona:77', expect.any(Object));
  });
  it('creates a monthly or quarterly missed-control signal once and does not re-notify an unchanged lapse', async () => {
    const alerts = repo(); const measurements = repo(); const responsables = repo(); const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const service = new GrowthService(repo() as any, repo() as any, repo() as any, alerts as any, measurements as any, responsables as any, outbox as any);
    measurements.findOne.mockResolvedValue(null); alerts.findOne.mockResolvedValue(null); alerts.save.mockImplementation(async value => ({ ...value, id: 'alert-1' })); responsables.find.mockResolvedValue([{ persona_id: '77' }, { persona_id: '77' }]);
    await expect(service.recalculateMissedControls([{ id: '4', persona_id: '100' }], [{ persona_id: '100', fecha_nacimiento: '2025-01-01' }], { personaId: '8' })).resolves.toBe(1);
    expect(alerts.save).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'CONTROL_AUSENTE', estado: 'PENDIENTE', medicion_id: null })); expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    const saved = (alerts.save.mock.calls[0][0]); alerts.findOne.mockResolvedValue(saved); await expect(service.recalculateMissedControls([{ id: '4', persona_id: '100' }], [{ persona_id: '100', fecha_nacimiento: '2025-01-01' }], { personaId: '8' })).resolves.toBe(0); expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });
  it('resolves the superseded measurement alerts without erasing their history', async () => {
    const alerts = repo(); const service = new GrowthService(repo() as any, repo() as any, repo() as any, alerts as any, repo() as any, repo() as any, {} as any); const alert = { id: 'a-1', estado: 'PENDIENTE' };
    alerts.find.mockResolvedValue([alert]); alerts.save.mockImplementation(async value => value); await expect(service.resolveAlertsForSupersededMeasurement('9', { personaId: '8' })).resolves.toBe(1); expect(alerts.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-1', estado: 'RESUELTA', updated_by_persona_id: '8' }));
  });
  it('requires a seeded WHO standard before accepting clinical growth controls', async () => {
    const standards = repo(); const service = new GrowthService(standards as any, repo() as any, repo() as any, repo() as any, repo() as any, repo() as any, {} as any); standards.exist.mockResolvedValue(false);
    await expect(service.ensureAvailable()).rejects.toThrow('estándar OMS');
  });
  it('derives the displayed P3–P97 weight-for-age bands from the versioned OMS LMS rows', async () => {
    const standards = repo(); const parameters = repo(); const service = new GrowthService(standards as any, parameters as any, repo() as any, repo() as any, repo() as any, repo() as any, {} as any);
    standards.findOne.mockResolvedValue({ id: '1', codigo: 'WHO-CGS-2006-0-5', version_fuente: 'WHO 2006', sha256_datos: 'a'.repeat(64) }); parameters.find.mockResolvedValue([{ x: '0', l: '.3487', m: '3.3464', s: '.14602' }]);
    await expect(service.weightForAgeCurves({ sexo: 'MASCULINO' })).resolves.toMatchObject({ estado: 'EVALUABLE', indicador: 'PESO_EDAD', sexo_curva: 'MASCULINO', puntos: [expect.objectContaining({ edad_dias: 0, p3: expect.any(Number), p5: expect.any(Number), p50: 3.346, p85: expect.any(Number), p95: expect.any(Number), p97: expect.any(Number) })] });
    expect(parameters.find).toHaveBeenCalledWith(expect.objectContaining({ where: { estandar_id: '1', indicador: 'PESO_EDAD', sexo_curva: 'MASCULINO' } }));
  });
});
