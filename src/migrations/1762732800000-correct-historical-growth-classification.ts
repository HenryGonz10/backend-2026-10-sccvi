import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The preceding OMS migration used a TALLA default solely to add a non-null
 * column to an existing table.  That value is not clinical evidence.  Preserve
 * every historical row, but remove it from clinical use until a professional
 * supplies the observed position in a later audited correction.
 */
export class CorrectHistoricalGrowthClassification1762732800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP CONSTRAINT DF_sccvi_medicion_tipo');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP CONSTRAINT CK_sccvi_medicion_tipo');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP CONSTRAINT CK_sccvi_medicion_estado');
    await q.query('DROP INDEX UQ_sccvi_medicion_vigente ON sccvi_mediciones_antropometricas');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas ALTER COLUMN estado VARCHAR(32) NOT NULL');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas ALTER COLUMN tipo_medicion VARCHAR(16) NULL');
    await q.query(`UPDATE m SET estado = 'PENDIENTE_CLASIFICACION', tipo_medicion = NULL
      FROM sccvi_mediciones_antropometricas m
      WHERE m.estado = 'VIGENTE'
        AND NOT EXISTS (SELECT 1 FROM sccvi_evaluaciones_crecimiento e WHERE e.medicion_id = m.id)`);
    await q.query("ALTER TABLE sccvi_mediciones_antropometricas ADD CONSTRAINT CK_sccvi_medicion_tipo CHECK(tipo_medicion IS NULL OR tipo_medicion IN ('LONGITUD','TALLA'))");
    await q.query("ALTER TABLE sccvi_mediciones_antropometricas ADD CONSTRAINT CK_sccvi_medicion_estado CHECK(estado IN ('VIGENTE','CORREGIDA','PENDIENTE_CLASIFICACION'))");
    await q.query("CREATE UNIQUE INDEX UQ_sccvi_medicion_vigente ON sccvi_mediciones_antropometricas(menor_id,fecha) WHERE estado = 'VIGENTE'");

    // Keep one current condition per minor and indicator. Historical conditions
    // remain auditable as RESUELTA rather than being deleted.
    await q.query(`WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY menor_id, tipo ORDER BY created_at DESC, id DESC) AS rn
      FROM sccvi_alertas_clinicas WHERE estado = 'PENDIENTE'
    ) UPDATE a SET estado = 'RESUELTA', updated_at = SYSUTCDATETIME()
      FROM sccvi_alertas_clinicas a INNER JOIN ranked r ON r.id = a.id WHERE r.rn > 1`);
    await q.query("CREATE UNIQUE INDEX UQ_sccvi_alerta_clinica_activa ON sccvi_alertas_clinicas(menor_id,tipo) WHERE estado = 'PENDIENTE'");
    await q.query("CREATE INDEX IX_sccvi_medicion_clinica_vigente ON sccvi_mediciones_antropometricas(menor_id,fecha DESC,id DESC) WHERE estado = 'VIGENTE' AND tipo_medicion IS NOT NULL");
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX IX_sccvi_medicion_clinica_vigente ON sccvi_mediciones_antropometricas');
    await q.query('DROP INDEX UQ_sccvi_alerta_clinica_activa ON sccvi_alertas_clinicas');
    await q.query('DROP INDEX UQ_sccvi_medicion_vigente ON sccvi_mediciones_antropometricas');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP CONSTRAINT CK_sccvi_medicion_estado');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP CONSTRAINT CK_sccvi_medicion_tipo');
    await q.query("UPDATE sccvi_mediciones_antropometricas SET tipo_medicion = 'TALLA', estado = 'VIGENTE' WHERE estado = 'PENDIENTE_CLASIFICACION'");
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas ALTER COLUMN estado VARCHAR(16) NOT NULL');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas ALTER COLUMN tipo_medicion VARCHAR(16) NOT NULL');
    await q.query("ALTER TABLE sccvi_mediciones_antropometricas ADD CONSTRAINT DF_sccvi_medicion_tipo DEFAULT 'TALLA' FOR tipo_medicion");
    await q.query("ALTER TABLE sccvi_mediciones_antropometricas ADD CONSTRAINT CK_sccvi_medicion_tipo CHECK(tipo_medicion IN ('LONGITUD','TALLA'))");
    await q.query("ALTER TABLE sccvi_mediciones_antropometricas ADD CONSTRAINT CK_sccvi_medicion_estado CHECK(estado IN ('VIGENTE','CORREGIDA'))");
    await q.query("CREATE UNIQUE INDEX UQ_sccvi_medicion_vigente ON sccvi_mediciones_antropometricas(menor_id,fecha) WHERE estado = 'VIGENTE'");
  }
}
