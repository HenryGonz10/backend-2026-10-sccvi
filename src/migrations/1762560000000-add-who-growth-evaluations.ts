import { MigrationInterface, QueryRunner } from 'typeorm';

/** Normalized, versioned WHO growth parameters and immutable evaluation evidence. */
export class AddWhoGrowthEvaluations1762560000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query("ALTER TABLE sccvi_mediciones_antropometricas ADD tipo_medicion VARCHAR(16) NOT NULL CONSTRAINT DF_sccvi_medicion_tipo DEFAULT 'TALLA'");
    await q.query("ALTER TABLE sccvi_mediciones_antropometricas ADD estado VARCHAR(16) NOT NULL CONSTRAINT DF_sccvi_medicion_estado DEFAULT 'VIGENTE'");
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas ADD corrige_medicion_id BIGINT NULL');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas ADD motivo_correccion NVARCHAR(500) NULL');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP CONSTRAINT UQ_sccvi_medicion');
    await q.query("CREATE UNIQUE INDEX UQ_sccvi_medicion_vigente ON sccvi_mediciones_antropometricas(menor_id,fecha) WHERE estado = 'VIGENTE'");
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas ADD CONSTRAINT FK_sccvi_medicion_correccion FOREIGN KEY(corrige_medicion_id) REFERENCES sccvi_mediciones_antropometricas(id)');
    await q.query("ALTER TABLE sccvi_mediciones_antropometricas ADD CONSTRAINT CK_sccvi_medicion_tipo CHECK(tipo_medicion IN ('LONGITUD','TALLA'))");
    await q.query("ALTER TABLE sccvi_mediciones_antropometricas ADD CONSTRAINT CK_sccvi_medicion_estado CHECK(estado IN ('VIGENTE','CORREGIDA'))");

    await q.query(`CREATE TABLE sccvi_estandares_crecimiento (
      id BIGINT IDENTITY(1,1) PRIMARY KEY, codigo VARCHAR(40) NOT NULL, nombre NVARCHAR(180) NOT NULL,
      version_fuente NVARCHAR(180) NOT NULL, fuente_url NVARCHAR(500) NOT NULL, sha256_datos CHAR(64) NOT NULL,
      edad_minima_dias INT NOT NULL, edad_maxima_dias INT NOT NULL, estado BIT NOT NULL DEFAULT 1,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      created_by_persona_id BIGINT NULL, updated_by_persona_id BIGINT NULL, version INT NOT NULL DEFAULT 1,
      CONSTRAINT UQ_sccvi_estandar_crecimiento UNIQUE(codigo),
      CONSTRAINT CK_sccvi_estandar_edades CHECK(edad_minima_dias >= 0 AND edad_maxima_dias >= edad_minima_dias)
    )`);
    await q.query(`CREATE TABLE sccvi_parametros_crecimiento (
      id BIGINT IDENTITY(1,1) PRIMARY KEY, estandar_id BIGINT NOT NULL, indicador VARCHAR(32) NOT NULL,
      sexo_curva VARCHAR(16) NOT NULL, x DECIMAL(8,2) NOT NULL, l DECIMAL(16,8) NOT NULL,
      m DECIMAL(16,8) NOT NULL, s DECIMAL(16,8) NOT NULL,
      CONSTRAINT UQ_sccvi_parametro_crecimiento UNIQUE(estandar_id,indicador,sexo_curva,x),
      CONSTRAINT FK_sccvi_parametro_estandar FOREIGN KEY(estandar_id) REFERENCES sccvi_estandares_crecimiento(id),
      CONSTRAINT CK_sccvi_parametro_sexo CHECK(sexo_curva IN ('MASCULINO','FEMENINO'))
    )`);
    await q.query(`CREATE TABLE sccvi_evaluaciones_crecimiento (
      id BIGINT IDENTITY(1,1) PRIMARY KEY, medicion_id BIGINT NOT NULL, estandar_id BIGINT NOT NULL,
      indicador VARCHAR(32) NOT NULL, sexo_curva VARCHAR(16) NOT NULL, edad_dias INT NOT NULL,
      tipo_medicion VARCHAR(16) NOT NULL, valor_entrada DECIMAL(8,2) NOT NULL, x_referencia DECIMAL(8,2) NOT NULL,
      l DECIMAL(16,8) NULL, m DECIMAL(16,8) NULL, s DECIMAL(16,8) NULL,
      puntuacion_z DECIMAL(8,4) NULL, percentil DECIMAL(8,4) NULL, clasificacion VARCHAR(32) NOT NULL,
      estado VARCHAR(32) NOT NULL, detalle NVARCHAR(500) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      created_by_persona_id BIGINT NULL, updated_by_persona_id BIGINT NULL, version INT NOT NULL DEFAULT 1,
      CONSTRAINT UQ_sccvi_evaluacion_crecimiento UNIQUE(medicion_id,indicador),
      CONSTRAINT FK_sccvi_evaluacion_medicion FOREIGN KEY(medicion_id) REFERENCES sccvi_mediciones_antropometricas(id),
      CONSTRAINT FK_sccvi_evaluacion_estandar FOREIGN KEY(estandar_id) REFERENCES sccvi_estandares_crecimiento(id)
    )`);
    await q.query(`CREATE TABLE sccvi_alertas_clinicas (
      id BIGINT IDENTITY(1,1) PRIMARY KEY, menor_id BIGINT NOT NULL, medicion_id BIGINT NULL,
      tipo VARCHAR(40) NOT NULL, severidad VARCHAR(16) NOT NULL, estado VARCHAR(24) NOT NULL DEFAULT 'PENDIENTE',
      notificado_at DATETIME2 NULL, detalle NVARCHAR(500) NULL,
      created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      created_by_persona_id BIGINT NULL, updated_by_persona_id BIGINT NULL, version INT NOT NULL DEFAULT 1,
      CONSTRAINT UQ_sccvi_alerta_clinica UNIQUE(menor_id,medicion_id,tipo),
      CONSTRAINT FK_sccvi_alerta_clinica_menor FOREIGN KEY(menor_id) REFERENCES sccvi_menores(id),
      CONSTRAINT FK_sccvi_alerta_clinica_medicion FOREIGN KEY(medicion_id) REFERENCES sccvi_mediciones_antropometricas(id)
    )`);
    await q.query('CREATE INDEX IX_sccvi_evaluacion_medicion ON sccvi_evaluaciones_crecimiento(medicion_id,estado)');
    await q.query('CREATE INDEX IX_sccvi_alerta_clinica_estado ON sccvi_alertas_clinicas(estado,tipo,menor_id)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE sccvi_alertas_clinicas');
    await q.query('DROP TABLE sccvi_evaluaciones_crecimiento');
    await q.query('DROP TABLE sccvi_parametros_crecimiento');
    await q.query('DROP TABLE sccvi_estandares_crecimiento');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP CONSTRAINT FK_sccvi_medicion_correccion');
    await q.query('DROP INDEX UQ_sccvi_medicion_vigente ON sccvi_mediciones_antropometricas');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP CONSTRAINT CK_sccvi_medicion_estado');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP CONSTRAINT CK_sccvi_medicion_tipo');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas ADD CONSTRAINT UQ_sccvi_medicion UNIQUE(menor_id,fecha)');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP COLUMN motivo_correccion');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP COLUMN corrige_medicion_id');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP CONSTRAINT DF_sccvi_medicion_estado');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP COLUMN estado');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP CONSTRAINT DF_sccvi_medicion_tipo');
    await q.query('ALTER TABLE sccvi_mediciones_antropometricas DROP COLUMN tipo_medicion');
  }
}
