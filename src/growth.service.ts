import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AlertaClinica, EstandarCrecimiento, EvaluacionCrecimiento, MedicionAntropometrica, MenorResponsable, ParametroCrecimiento } from './entities';
import { correctedLengthCm, evaluateGrowth, GrowthCurveSex, GrowthIndicator, interpolatedLms } from './growth-calculator';
import { OutboxService } from './outbox.service';

type PersonClinicalIdentity = { fecha_nacimiento?: string; sexo?: string };
type Principal = { personaId?: string | null };
@Injectable()
export class GrowthService {
  constructor(
    @InjectRepository(EstandarCrecimiento) private readonly standards: Repository<EstandarCrecimiento>,
    @InjectRepository(ParametroCrecimiento) private readonly parameters: Repository<ParametroCrecimiento>,
    @InjectRepository(EvaluacionCrecimiento) private readonly evaluations: Repository<EvaluacionCrecimiento>,
    @InjectRepository(AlertaClinica) private readonly alerts: Repository<AlertaClinica>,
    @InjectRepository(MedicionAntropometrica) private readonly measurements: Repository<MedicionAntropometrica>,
    @InjectRepository(MenorResponsable) private readonly responsables: Repository<MenorResponsable>,
    private readonly outbox: OutboxService,
  ) {}

  private ageDays(birth: string, date: string) { return Math.floor((new Date(`${date}T12:00:00Z`).getTime() - new Date(`${birth}T12:00:00Z`).getTime()) / 86_400_000); }
  private curveSex(person: PersonClinicalIdentity, override?: string): GrowthCurveSex {
    const sex = override ?? person.sexo;
    if (sex === 'MASCULINO' || sex === 'FEMENINO') return sex;
    throw new UnprocessableEntityException('La identidad de sexo no permite seleccionar una curva OMS; indique sexo_curva_evaluacion clínicamente documentado.');
  }
  async ensureAvailable() { if (!await this.standards.exist({ where: { codigo: 'WHO-CGS-2006-0-5', estado: true } })) throw new ServiceUnavailableException('El estándar OMS de crecimiento no está cargado todavía.'); }
  /** Values are derived from the archived WHO LMS rows, never from a fitted prediction. */
  async weightForAgeCurves(person: PersonClinicalIdentity) {
    const standard = await this.standards.findOne({ where: { codigo: 'WHO-CGS-2006-0-5', estado: true } });
    if (!standard) throw new ServiceUnavailableException('El estándar OMS de crecimiento no está cargado todavía.');
    if (person.sexo !== 'MASCULINO' && person.sexo !== 'FEMENINO') return { estado: 'NO_EVALUABLE' as const, motivo: 'La identidad de sexo requiere una selección clínica explícita para mostrar curvas OMS.', estandar: { codigo: standard.codigo, version_fuente: standard.version_fuente, sha256_datos: standard.sha256_datos } };
    const rows = await this.parameters.find({ where: { estandar_id: standard.id, indicador: 'PESO_EDAD', sexo_curva: person.sexo }, order: { x: 'ASC' } });
    const percentiles: Record<string, number> = { p3: -1.8807936081512509, p5: -1.6448536269514729, p50: 0, p85: 1.0364333894937896, p95: 1.6448536269514722, p97: 1.8807936081512509 };
    const valueAt = (l: number, m: number, s: number, z: number) => l === 0 ? m * Math.exp(s * z) : m * Math.pow(1 + l * s * z, 1 / l);
    return { estado: 'EVALUABLE' as const, indicador: 'PESO_EDAD', sexo_curva: person.sexo, estandar: { codigo: standard.codigo, version_fuente: standard.version_fuente, sha256_datos: standard.sha256_datos }, puntos: rows.map(row => { const l = Number(row.l); const m = Number(row.m); const s = Number(row.s); return { edad_dias: Number(row.x), ...Object.fromEntries(Object.entries(percentiles).map(([name, z]) => [name, Number(valueAt(l, m, s, z).toFixed(3))])) }; }) };
  }
  async evaluate(measurement: MedicionAntropometrica, person: PersonClinicalIdentity, principal: Principal, curveOverride?: string) {
    if (!person.fecha_nacimiento) throw new UnprocessableEntityException('SSO debe proporcionar fecha de nacimiento para evaluar crecimiento.');
    const standard = await this.standards.findOne({ where: { codigo: 'WHO-CGS-2006-0-5', estado: true } });
    if (!standard) throw new ServiceUnavailableException('El estándar OMS de crecimiento no está cargado todavía.');
    const ageDays = this.ageDays(person.fecha_nacimiento, measurement.fecha);
    if (ageDays < standard.edad_minima_dias || ageDays > standard.edad_maxima_dias) throw new UnprocessableEntityException(`La edad exacta (${ageDays} días) está fuera del estándar OMS configurado.`);
    const sex = this.curveSex(person, curveOverride); const correctedHeight = correctedLengthCm(Number(measurement.talla_cm), ageDays, measurement.tipo_medicion as 'LONGITUD' | 'TALLA');
    const values: Array<{ indicator: GrowthIndicator; value: number; x: number }> = [
      { indicator: 'PESO_EDAD', value: Number(measurement.peso_kg), x: ageDays },
      { indicator: 'LONGITUD_TALLA_EDAD', value: correctedHeight, x: ageDays },
      { indicator: 'IMC_EDAD', value: Number(measurement.imc), x: ageDays },
      { indicator: ageDays < 731 ? 'PESO_LONGITUD' : 'PESO_TALLA', value: Number(measurement.peso_kg), x: correctedHeight },
    ];
    const saved: EvaluacionCrecimiento[] = [];
    for (const candidate of values) {
      const parameterRows = await this.parameters.find({ where: { estandar_id: standard.id, indicador: candidate.indicator, sexo_curva: sex }, order: { x: 'ASC' } });
      const lms = interpolatedLms(parameterRows.map(row => ({ x: Number(row.x), l: Number(row.l), m: Number(row.m), s: Number(row.s) })), candidate.x);
      const result = lms ? evaluateGrowth(candidate.indicator, candidate.value, lms) : { z: Number.NaN, percentile: null, classification: 'NO_EVALUABLE', state: 'IMPLAUSIBLE' as const, detail: `No hay parámetro OMS para ${candidate.indicator} en x=${candidate.x.toFixed(2)}.` };
      const evaluation = await this.evaluations.save(this.evaluations.create({
        medicion_id: measurement.id, estandar_id: standard.id, indicador: candidate.indicator, sexo_curva: sex, edad_dias: ageDays, tipo_medicion: measurement.tipo_medicion,
        valor_entrada: candidate.value.toFixed(2), x_referencia: candidate.x.toFixed(2), l: lms?.l.toFixed(8) ?? null, m: lms?.m.toFixed(8) ?? null, s: lms?.s.toFixed(8) ?? null,
        puntuacion_z: Number.isFinite(result.z) ? result.z.toFixed(4) : null, percentil: result.percentile === null ? null : result.percentile.toFixed(4), clasificacion: result.classification, estado: result.state, detalle: result.detail,
        created_by_persona_id: principal.personaId ?? null, updated_by_persona_id: principal.personaId ?? null,
      }));
      saved.push(evaluation);
      if (result.state === 'EVALUABLE' && result.classification !== 'ADECUADO') {
        const tipo = result.classification === 'BAJO_P5' ? `CRECIMIENTO_BAJO_P5_${candidate.indicator}` : `CRECIMIENTO_ALTO_P95_${candidate.indicator}`;
        const exists = await this.alerts.exist({ where: { menor_id: measurement.menor_id, medicion_id: measurement.id, tipo } });
        if (!exists) {
          const alert = await this.alerts.save(this.alerts.create({ menor_id: measurement.menor_id, medicion_id: measurement.id, tipo, severidad: result.classification === 'BAJO_P5' ? 'ALTA' : 'MEDIA', estado: 'PENDIENTE', notificado_at: null, detalle: `${candidate.indicator}: Z=${result.z.toFixed(2)}${result.percentile === null ? '' : `, P=${result.percentile.toFixed(1)}`}.`, created_by_persona_id: principal.personaId ?? null, updated_by_persona_id: principal.personaId ?? null }));
          const recipients = await this.responsables.find({ where: { menor_id: measurement.menor_id, estado: true }, select: { persona_id: true } });
          await Promise.all([...new Set(recipients.map(item => item.persona_id))].map(personaId => this.outbox.enqueue(personaId, measurement.menor_id, 'SCCVI_ALERTA_CRECIMIENTO', { alerta_id: alert.id, menor_id: measurement.menor_id, indicador: candidate.indicator, clasificacion: result.classification }, `crecimiento:${alert.id}:persona:${personaId}`, { titulo: 'Alerta de crecimiento', contenido: 'Existe una alerta de crecimiento que requiere seguimiento por el equipo de salud.' })));
        }
      }
    }
    return { standard: { codigo: standard.codigo, sha256_datos: standard.sha256_datos }, edad_dias: ageDays, talla_corregida_cm: correctedHeight, evaluaciones: saved };
  }

  async forMeasurement(measurementId: string) { return this.evaluations.find({ where: { medicion_id: measurementId }, order: { id: 'ASC' } }); }
  async alertsForMinor(menorId: string) { return this.alerts.find({ where: { menor_id: menorId }, order: { id: 'DESC' } }); }
  async resolveAlertsForSupersededMeasurement(measurementId: string, principal: Principal) {
    const alerts = await this.alerts.find({ where: { medicion_id: measurementId, estado: 'PENDIENTE' } });
    for (const alert of alerts) { alert.estado = 'RESUELTA'; alert.updated_by_persona_id = principal.personaId ?? null; await this.alerts.save(alert); }
    return alerts.length;
  }
  async reportingMetadata() {
    const standard = await this.standards.findOne({ where: { codigo: 'WHO-CGS-2006-0-5', estado: true } });
    return standard ? { codigo: standard.codigo, version_fuente: standard.version_fuente, fuente_url: standard.fuente_url, sha256_datos: standard.sha256_datos } : null;
  }
  /** 0–<2 años: mensual; 2–5 años: trimestral. An alert is reopened only when a new lapse occurs. */
  async recalculateMissedControls(minors: Array<{ id: string; persona_id: string }>, people: Array<PersonClinicalIdentity & { persona_id?: string }>, principal: Principal) {
    const birthdates = new Map(people.filter(person => person.persona_id && /^\d{4}-\d{2}-\d{2}$/.test(person.fecha_nacimiento ?? '')).map(person => [person.persona_id!, person.fecha_nacimiento!]));
    const today = new Date().toISOString().slice(0, 10); let changed = 0;
    for (const minor of minors) {
      const birth = birthdates.get(minor.persona_id); if (!birth) continue;
      const age = this.ageDays(birth, today); if (age < 0 || age > 1826) continue;
      const intervalDays = age < 731 ? 31 : 92;
      const latest = await this.measurements.findOne({ where: { menor_id: minor.id, estado: 'VIGENTE' }, order: { fecha: 'DESC', id: 'DESC' } });
      const anchor = latest?.fecha ?? birth; const due = new Date(`${anchor}T12:00:00Z`); due.setUTCDate(due.getUTCDate() + intervalDays); const dueDate = due.toISOString().slice(0, 10);
      const existing = await this.alerts.findOne({ where: { menor_id: minor.id, tipo: 'CONTROL_AUSENTE' }, order: { id: 'DESC' } });
      if (dueDate > today) {
        if (existing && existing.estado !== 'RESUELTA') { existing.estado = 'RESUELTA'; existing.updated_by_persona_id = principal.personaId ?? null; await this.alerts.save(existing); changed++; }
        continue;
      }
      const detail = `Control de crecimiento vencido desde ${dueDate}; intervalo esperado: ${age < 731 ? 'mensual (0 a <2 años)' : 'trimestral (2 a 5 años)'}.`;
      const reopened = Boolean(existing && existing.estado === 'RESUELTA');
      if (existing && !reopened && existing.estado === 'PENDIENTE' && existing.detalle === detail) continue;
      const alert = existing ? await this.alerts.save(Object.assign(existing, { estado: 'PENDIENTE', severidad: 'MEDIA', detalle: detail, updated_by_persona_id: principal.personaId ?? null })) : await this.alerts.save(this.alerts.create({ menor_id: minor.id, medicion_id: null, tipo: 'CONTROL_AUSENTE', severidad: 'MEDIA', estado: 'PENDIENTE', notificado_at: null, detalle: detail, created_by_persona_id: principal.personaId ?? null, updated_by_persona_id: principal.personaId ?? null }));
      if (!existing || reopened) {
        const recipients = await this.responsables.find({ where: { menor_id: minor.id, estado: true }, select: { persona_id: true } });
        await Promise.all([...new Set(recipients.map(item => item.persona_id))].map(personaId => this.outbox.enqueue(personaId, minor.id, 'SCCVI_CONTROL_PENDIENTE', { alerta_id: alert.id, menor_id: minor.id, fecha_limite: dueDate }, `control-ausente:${minor.id}:${dueDate}:persona:${personaId}`, { titulo: 'Control de crecimiento pendiente', contenido: 'El menor requiere un control de crecimiento. Acuda al centro de salud.' })));
      }
      changed++;
    }
    return changed;
  }
  async reportForMinors(minorIds: string[]) {
    if (!minorIds.length) return { evaluaciones: 0, bajo_p5: 0, alto_p95: 0, no_evaluables: 0, promedio_z_por_indicador: {}, alertas: [] as AlertaClinica[] };
    const measurementIds = (await this.measurements.find({ where: { menor_id: In(minorIds) }, select: { id: true } })).map(item => item.id);
    const [evaluations, alerts] = await Promise.all([measurementIds.length ? this.evaluations.find({ where: { medicion_id: In(measurementIds) } }) : Promise.resolve([] as EvaluacionCrecimiento[]), this.alerts.find({ where: { menor_id: In(minorIds), estado: 'PENDIENTE' }, order: { id: 'DESC' } })]);
    const evaluable = evaluations.filter(item => item.estado === 'EVALUABLE'); const averages = new Map<string, { sum: number; count: number }>();
    for (const item of evaluable) if (item.puntuacion_z !== null) { const value = averages.get(item.indicador) ?? { sum: 0, count: 0 }; value.sum += Number(item.puntuacion_z); value.count += 1; averages.set(item.indicador, value); }
    return { evaluaciones: evaluations.length, bajo_p5: evaluable.filter(item => item.clasificacion === 'BAJO_P5').length, alto_p95: evaluable.filter(item => item.clasificacion === 'ALTO_P95').length, no_evaluables: evaluations.filter(item => item.estado !== 'EVALUABLE').length, promedio_z_por_indicador: Object.fromEntries([...averages.entries()].map(([indicator, value]) => [indicator, Number((value.sum / value.count).toFixed(4))])), alertas: alerts };
  }
}
