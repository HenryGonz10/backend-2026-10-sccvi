import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVaccinationApplicationLocation1762300800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE sccvi_registros_vacunacion ADD departamento_codigo CHAR(2) NULL, municipio_codigo CHAR(4) NULL, comunidad_ref UNIQUEIDENTIFIER NULL');
    await q.query("CREATE INDEX IX_registros_vacunacion_territorio ON sccvi_registros_vacunacion(estado, departamento_codigo, municipio_codigo, fecha_aplicacion)");
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX IX_registros_vacunacion_territorio ON sccvi_registros_vacunacion');
    await q.query('ALTER TABLE sccvi_registros_vacunacion DROP COLUMN departamento_codigo, municipio_codigo, comunidad_ref');
  }
}
