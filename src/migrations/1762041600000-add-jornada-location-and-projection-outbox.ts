import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJornadaLocationAndProjectionOutbox1762041600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query("ALTER TABLE sccvi_jornadas_vacunacion ADD departamento_codigo CHAR(2) NULL, municipio_codigo CHAR(4) NULL, comunidad_ref UNIQUEIDENTIFIER NULL");
    await q.query("CREATE TABLE sccvi_outbox_proyecciones (id BIGINT IDENTITY(1,1) PRIMARY KEY, menor_id BIGINT NOT NULL, idempotency_key VARCHAR(128) NOT NULL UNIQUE, estado VARCHAR(24) NOT NULL DEFAULT 'PENDIENTE', intentos INT NOT NULL DEFAULT 0, publicado_at DATETIME2 NULL, ultimo_error NVARCHAR(500) NULL, created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), created_by_persona_id BIGINT NULL, updated_by_persona_id BIGINT NULL, version INT NOT NULL DEFAULT 1)");
    await q.query('CREATE INDEX IX_outbox_proyecciones_lookup ON sccvi_outbox_proyecciones(estado, intentos, id)');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE sccvi_outbox_proyecciones');
    await q.query('ALTER TABLE sccvi_jornadas_vacunacion DROP COLUMN departamento_codigo, municipio_codigo, comunidad_ref');
  }
}
