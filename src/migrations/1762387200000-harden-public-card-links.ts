import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds a salted verifier hash without invalidating already-issued, revocable links. */
export class HardenPublicCardLinks1762387200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE sccvi_carnes_publicos ADD token_hash VARCHAR(255) NULL');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE sccvi_carnes_publicos DROP COLUMN token_hash');
  }
}
