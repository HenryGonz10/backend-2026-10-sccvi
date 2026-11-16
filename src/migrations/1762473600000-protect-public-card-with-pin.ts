import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Public cards issued before this migration cannot acquire a recoverable PIN.
 * They are revoked so every active QR follows the same explicit PIN contract.
 */
export class ProtectPublicCardWithPin1762473600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE sccvi_carnes_publicos ADD pin_hash VARCHAR(255) NULL');
    await q.query('ALTER TABLE sccvi_carnes_publicos ADD intentos_fallidos INT NOT NULL CONSTRAINT DF_sccvi_carnes_intentos DEFAULT 0');
    await q.query('ALTER TABLE sccvi_carnes_publicos ADD bloqueado_hasta DATETIME2 NULL');
    await q.query('ALTER TABLE sccvi_carnes_publicos ADD ultimo_acceso_at DATETIME2 NULL');
    await q.query('UPDATE sccvi_carnes_publicos SET estado = 0 WHERE estado = 1');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE sccvi_carnes_publicos DROP COLUMN ultimo_acceso_at');
    await q.query('ALTER TABLE sccvi_carnes_publicos DROP COLUMN bloqueado_hasta');
    await q.query('ALTER TABLE sccvi_carnes_publicos DROP CONSTRAINT DF_sccvi_carnes_intentos');
    await q.query('ALTER TABLE sccvi_carnes_publicos DROP COLUMN intentos_fallidos');
    await q.query('ALTER TABLE sccvi_carnes_publicos DROP COLUMN pin_hash');
  }
}
