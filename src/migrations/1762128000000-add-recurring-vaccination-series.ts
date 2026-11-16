import { MigrationInterface, QueryRunner } from 'typeorm';

/** Enables recurring catalogue doses (for example, annual influenza) without
 * overwriting the child's previous clinical applications. */
export class AddRecurringVaccinationSeries1762128000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE sccvi_esquema_dosis ADD intervalo_repeticion_dias INT NULL');
    await q.query('ALTER TABLE sccvi_registros_vacunacion ADD secuencia INT NOT NULL CONSTRAINT DF_sccvi_registro_secuencia DEFAULT 1');
    await q.query('ALTER TABLE sccvi_registros_vacunacion DROP CONSTRAINT UQ_sccvi_aplicacion');
    await q.query('ALTER TABLE sccvi_registros_vacunacion ADD CONSTRAINT UQ_sccvi_aplicacion UNIQUE(menor_id, esquema_dosis_id, secuencia)');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE sccvi_registros_vacunacion DROP CONSTRAINT UQ_sccvi_aplicacion');
    await q.query('ALTER TABLE sccvi_registros_vacunacion DROP CONSTRAINT DF_sccvi_registro_secuencia');
    await q.query('ALTER TABLE sccvi_registros_vacunacion DROP COLUMN secuencia');
    await q.query('ALTER TABLE sccvi_esquema_dosis DROP COLUMN intervalo_repeticion_dias');
    await q.query('ALTER TABLE sccvi_registros_vacunacion ADD CONSTRAINT UQ_sccvi_aplicacion UNIQUE(menor_id, esquema_dosis_id)');
  }
}
