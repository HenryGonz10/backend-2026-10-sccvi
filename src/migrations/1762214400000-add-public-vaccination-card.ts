import { MigrationInterface, QueryRunner } from 'typeorm';

/** A public card is an opaque, revocable reading link; it never exposes CUI or guardians. */
export class AddPublicVaccinationCard1762214400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query("CREATE TABLE sccvi_carnes_publicos (id BIGINT IDENTITY(1,1) PRIMARY KEY, menor_id BIGINT NOT NULL, token VARCHAR(72) NOT NULL UNIQUE, estado BIT NOT NULL DEFAULT 1, expira_at DATETIME2 NULL, created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), created_by_persona_id BIGINT NULL, updated_by_persona_id BIGINT NULL, version INT NOT NULL DEFAULT 1, CONSTRAINT FK_sccvi_carne_publico_menor FOREIGN KEY(menor_id) REFERENCES sccvi_menores(id))");
    await q.query('CREATE INDEX IX_sccvi_carnes_publicos_lookup ON sccvi_carnes_publicos(menor_id,estado)');
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE sccvi_carnes_publicos'); }
}
