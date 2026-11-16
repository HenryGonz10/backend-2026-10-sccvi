import { SccviReadProjectionService } from './read-projection.service';

const repo = () => ({ find: jest.fn(), findOneBy: jest.fn() });

describe('SCCVI read projections', () => {
  const build = () => {
    const minors = repo(); const service = new SccviReadProjectionService({ get: jest.fn() } as never, minors as never, repo() as never, repo() as never, repo() as never, repo() as never);
    (service as any).connect = jest.fn().mockResolvedValue(true);
    return { service, minors };
  };

  it('rebuilds every page instead of leaving records after the first batch stale', async () => {
    const { service, minors } = build(); const project = jest.spyOn(service, 'project').mockResolvedValue();
    minors.find.mockResolvedValueOnce([{ id: '1' }, { id: '2' }]).mockResolvedValueOnce([{ id: '3' }]);
    await expect(service.rebuild(2)).resolves.toBe(3);
    expect(project).toHaveBeenCalledTimes(3);
    expect(minors.find).toHaveBeenNthCalledWith(1, expect.objectContaining({ skip: 0, take: 2 }));
    expect(minors.find).toHaveBeenNthCalledWith(2, expect.objectContaining({ skip: 2, take: 2 }));
  });

  it('paginates token search in Elasticsearch and preserves ranked order from Mongo', async () => {
    const { service } = build(); const collection = { find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([{ _id: '8' }, { _id: '7' }]) }) };
    (service as any).collection = collection; (service as any).elastic = { search: jest.fn().mockResolvedValue({ hits: { hits: [{ _id: '7' }, { _id: '8' }], total: { value: 5 } } }) };
    const page = await service.search('Pendiente', 2, 2);
    expect((service as any).elastic.search).toHaveBeenCalledWith(expect.objectContaining({ from: 2, size: 2 }));
    expect(page.items.map((item: { _id: string }) => item._id)).toEqual(['7', '8']);
    expect(page.meta).toEqual({ current_page: 2, per_page: 2, total: 5, last_page: 3 });
  });

  it('pushes applied, missing and date filters to Elasticsearch rather than filtering in the browser', async () => {
    const { service } = build(); const collection = { find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }) };
    (service as any).collection = collection; (service as any).elastic = { search: jest.fn().mockResolvedValue({ hits: { hits: [], total: { value: 0 } } }) };
    await service.search({ q: 'Ana', vacuna_codigo: 'PENTA', estado_vacuna: 'FALTA', ultima_vacuna_desde: '2026-01-01', ultima_vacuna_hasta: '2026-12-31', alerta_tipo: 'ATRASADA' });
    const query = (service as any).elastic.search.mock.calls[0][0].query.bool;
    expect(query.must).toEqual(expect.arrayContaining([expect.objectContaining({ prefix: { tokens: 'ana' } })]));
    expect(query.filter).toEqual(expect.arrayContaining([
      { term: { pendientes_vacuna_codigos: 'PENTA' } },
      { nested: { path: 'alertas', query: { term: { 'alertas.tipo': 'ATRASADA' } } } },
      { range: { ultima_vacuna_fecha: { gte: '2026-01-01', lte: '2026-12-31' } } },
    ]));
  });

  it('keeps applied vaccine code and state in the same nested vaccination record', async () => {
    const { service } = build(); const collection = { find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }) };
    (service as any).collection = collection; (service as any).elastic = { search: jest.fn().mockResolvedValue({ hits: { hits: [], total: { value: 0 } } }) };
    await service.search({ vacuna_codigo: 'PENTA', estado_vacuna: 'APLICADA' });
    expect((service as any).elastic.search.mock.calls[0][0].query.bool.filter).toEqual(expect.arrayContaining([{ nested: { path: 'vacunas', query: { bool: { filter: [{ term: { 'vacunas.codigo': 'PENTA' } }, { term: { 'vacunas.estado': 'VALIDA' } }] } } } }]));
  });

  it('filters an exact birth date inside the protected projection index', async () => {
    const { service } = build(); const collection = { find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }) };
    (service as any).collection = collection; (service as any).elastic = { search: jest.fn().mockResolvedValue({ hits: { hits: [], total: { value: 0 } } }) };
    await service.search({ fecha_nacimiento: '2025-03-12' });
    expect((service as any).elastic.search.mock.calls[0][0].query.bool.filter).toEqual(expect.arrayContaining([{ term: { 'persona.fecha_nacimiento': '2025-03-12' } }]));
  });
});
