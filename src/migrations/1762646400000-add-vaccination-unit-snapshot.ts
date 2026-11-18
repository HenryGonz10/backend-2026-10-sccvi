import { MigrationInterface, QueryRunner } from 'typeorm';

/** Keeps the administering establishment as it was at the time of care. */
export class AddVaccinationUnitSnapshot1762646400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE sccvi_registros_vacunacion ADD unidad_atencion_tag VARCHAR(32) NULL, unidad_atencion_nombre NVARCHAR(160) NULL');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE sccvi_registros_vacunacion DROP COLUMN unidad_atencion_tag, unidad_atencion_nombre');
  }
}
