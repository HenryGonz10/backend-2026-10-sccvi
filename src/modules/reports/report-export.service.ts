import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as PDFDocument from 'pdfkit';
import { SccviPrincipal } from '../../shared/auth/sso-jwt.guard';
import { SccviService } from '../minors/sccvi.service';

type Row = Record<string, string | number | null>;

@Injectable()
export class ReportExportService {
  constructor(private readonly sccvi: SccviService) {}
  private async report(principal: SccviPrincipal) {
    const pending = typeof this.sccvi.pendingReportAll === 'function' ? this.sccvi.pendingReportAll(principal) : this.sccvi.pendingReport({ page: 1, per_page: 100 }, principal).then(page => page.items);
    const [coverage, territory, growth, pendingItems, scope, standard] = await Promise.all([this.sccvi.coverage(principal), this.sccvi.applicationAnalytics(principal), this.sccvi.growthReport(principal), pending, this.sccvi.territoryFor(principal), this.sccvi.growthReportMetadata()]);
    return { coverage, territory, growth, pending: pendingItems, scope, standard, generated_at: new Date().toISOString(), generated_by_persona_id: principal.personaId ?? null };
  }
  private sheets(value: Awaited<ReturnType<ReportExportService['report']>>) {
    const summary: Row[] = [
      { indicador: 'Menores en territorio', valor: value.coverage.menores }, { indicador: 'Dosis esperadas', valor: value.coverage.dosis_esperadas }, { indicador: 'Dosis cumplidas', valor: value.coverage.dosis_cumplidas }, { indicador: 'Cobertura', valor: value.coverage.cobertura },
      { indicador: 'Evaluaciones crecimiento', valor: value.growth.evaluaciones }, { indicador: 'Crecimiento bajo P5', valor: value.growth.bajo_p5 }, { indicador: 'Crecimiento alto P95', valor: value.growth.alto_p95 }, { indicador: 'No evaluables', valor: value.growth.no_evaluables },
    ];
    const territories = value.territory.puntos.map(item => ({ departamento_codigo: item.departamento_codigo, municipio_codigo: item.municipio_codigo, aplicaciones: item.aplicaciones }));
    const vaccines = value.territory.vacunas.map(item => ({ codigo: item.codigo, vacuna: item.nombre, aplicaciones: item.aplicaciones }));
    const alerts = [...value.pending.map((item: { tipo: string; estado: string; fecha_programada: string; menor_id: string }) => ({ categoria: 'VACUNACION', tipo: item.tipo, estado: item.estado, fecha: item.fecha_programada, menor_id: item.menor_id })), ...value.growth.alertas.map((item: { tipo: string; estado: string; created_at: Date; menor_id: string }) => ({ categoria: 'CRECIMIENTO', tipo: item.tipo, estado: item.estado, fecha: item.created_at.toISOString(), menor_id: item.menor_id }))];
    const averages = Object.entries(value.growth.promedio_z_por_indicador).map(([indicador, promedio_z]) => ({ indicador, promedio_z }));
    const metadata: Row[] = [
      { campo: 'generado_en', valor: value.generated_at }, { campo: 'generado_por_persona_id', valor: value.generated_by_persona_id },
      { campo: 'departamento_codigo', valor: value.scope.departamento_codigo ?? 'TODOS_AUTORIZADOS' }, { campo: 'municipio_codigo', valor: value.scope.municipio_codigo ?? 'TODOS_AUTORIZADOS' },
      { campo: 'estandar_crecimiento', valor: value.standard?.codigo ?? 'NO_CARGADO' }, { campo: 'version_fuente_clinica', valor: value.standard?.version_fuente ?? 'NO_CARGADO' },
      { campo: 'fuente_clinica', valor: value.standard?.fuente_url ?? 'NO_CARGADO' }, { campo: 'sha256_estandar', valor: value.standard?.sha256_datos ?? 'NO_CARGADO' },
    ];
    return { metadata, summary, territories, vaccines, alerts, averages };
  }
  async build(format: string | undefined, principal: SccviPrincipal) {
    if (format !== 'xlsx' && format !== 'pdf') throw new BadRequestException('formato debe ser xlsx o pdf.');
    const report = await this.report(principal); const sheets = this.sheets(report); const stamp = report.generated_at.slice(0, 10);
    if (format === 'xlsx') return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `sccvi-reporte-${stamp}.xlsx`, body: await this.xlsx(sheets) };
    return { mime: 'application/pdf', filename: `sccvi-reporte-${stamp}.pdf`, body: await this.pdf(sheets, report.generated_at) };
  }
  private safeCell(value: string | number | null) { return typeof value === 'string' && /^[=+\-@]/.test(value) ? `'${value}` : value; }
  private async xlsx(sheets: ReturnType<ReportExportService['sheets']>) {
    const book = new ExcelJS.Workbook(); book.creator = 'SCCVI'; book.created = new Date();
    for (const [name, rows] of Object.entries(sheets)) {
      const sheet = book.addWorksheet(name.slice(0, 31)); const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
      sheet.columns = keys.map(key => ({ header: key.replaceAll('_', ' '), key, width: Math.max(14, key.length + 4) }));
      rows.forEach(row => sheet.addRow(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, this.safeCell(value as string | number | null)]))));
      sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + Math.max(keys.length, 1))}1` };
    }
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  private pdf(sheets: ReturnType<ReportExportService['sheets']>, generatedAt: string) {
    return new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: 'A4', margin: 44 }); const chunks: Buffer[] = []; pdf.on('data', chunk => chunks.push(Buffer.from(chunk))); pdf.on('error', reject); pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.fontSize(18).text('SCCVI — Reporte operativo'); pdf.moveDown(.3); pdf.fontSize(9).fillColor('#444').text(`Generado: ${generatedAt}. Alcance: territorio autorizado del solicitante.`); pdf.fillColor('#000').moveDown();
      for (const [name, rows] of Object.entries(sheets)) { pdf.fontSize(13).text(name.toUpperCase()); pdf.moveDown(.2); if (!rows.length) pdf.fontSize(9).text('Sin datos.'); else { const keys = Object.keys(rows[0]); pdf.fontSize(8); for (const row of rows) { if (pdf.y > 760) pdf.addPage(); pdf.text(keys.map(key => `${key.replaceAll('_', ' ')}: ${(row as Row)[key] ?? '—'}`).join('  |  ')); } } pdf.moveDown(); }
      pdf.fontSize(8).fillColor('#444').text('Datos clínicos para uso autorizado. El catálogo de vacunación DEMO no constituye recomendación clínica.'); pdf.end();
    });
  }
}
