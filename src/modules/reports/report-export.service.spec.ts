import { ReportExportService } from './report-export.service';
import * as ExcelJS from 'exceljs';

describe('ReportExportService', () => {
  const principal = { userId: '1', personaId: '2', scopes: ['sccvi.read'], roles: [], payload: {} } as any;
  const sccvi = {
    coverage: jest.fn().mockResolvedValue({ menores: 2, dosis_esperadas: 4, dosis_cumplidas: 3, cobertura: .75 }),
    applicationAnalytics: jest.fn().mockResolvedValue({ puntos: [{ departamento_codigo: '16', municipio_codigo: '1601', aplicaciones: 3 }], vacunas: [{ codigo: 'BCG', nombre: 'BCG', aplicaciones: 2 }] }),
    growthReport: jest.fn().mockResolvedValue({ evaluaciones: 3, bajo_p5: 1, alto_p95: 0, no_evaluables: 0, promedio_z_por_indicador: { PESO_EDAD: -1.2 }, alertas: [] }),
    growthReportMetadata: jest.fn().mockResolvedValue({ codigo: 'WHO-CGS-2006-0-5', version_fuente: 'OMS', fuente_url: 'https://www.who.int/', sha256_datos: 'a'.repeat(64) }),
    territoryFor: jest.fn().mockResolvedValue({ departamento_codigo: '16', municipio_codigo: '1601' }),
    pendingReport: jest.fn().mockResolvedValue({ items: [{ tipo: '=ATRASADA', estado: 'PENDIENTE', fecha_programada: '2026-01-01', menor_id: '7' }] }),
  };
  it('generates a real XLSX workbook from only territorial report data and records auditable metadata', async () => { const result = await new ReportExportService(sccvi as any).build('xlsx', principal); expect(result.mime).toContain('spreadsheetml'); expect(result.body.subarray(0, 2).toString()).toBe('PK'); expect(sccvi.coverage).toHaveBeenCalledWith(principal); const book = new ExcelJS.Workbook(); await book.xlsx.load(result.body as any); expect(book.getWorksheet('metadata')?.getCell('B3').value).toBe('2'); expect(book.getWorksheet('metadata')?.getCell('B6').value).toBe('WHO-CGS-2006-0-5'); expect(book.getWorksheet('alerts')?.getCell('B2').value).toBe("'=ATRASADA"); });
  it('generates a PDF report without asserting unverified clinical conclusions', async () => { const result = await new ReportExportService(sccvi as any).build('pdf', principal); expect(result.mime).toBe('application/pdf'); expect(result.body.subarray(0, 4).toString()).toBe('%PDF'); });
  it('rejects unsupported formats', async () => await expect(new ReportExportService(sccvi as any).build('csv', principal)).rejects.toThrow('formato'));
});
