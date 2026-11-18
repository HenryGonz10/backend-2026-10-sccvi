import { SccviService } from './sccvi.service';

describe('SCCVI full pending report pagination', () => {
  it('consumes all pending-alert pages instead of truncating at the UI page size', async () => {
    const pendingReport = jest.fn()
      .mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, index) => ({ id: String(index + 1) })), meta: { current_page: 1, per_page: 100, total: 201, last_page: 3 } })
      .mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, index) => ({ id: String(index + 101) })), meta: { current_page: 2, per_page: 100, total: 201, last_page: 3 } })
      .mockResolvedValueOnce({ items: [{ id: '201' }], meta: { current_page: 3, per_page: 100, total: 201, last_page: 3 } });
    const items = await SccviService.prototype.pendingReportAll.call({ pendingReport } as unknown as SccviService, { userId: '1', scopes: [], roles: [], payload: {} } as never);
    expect(items).toHaveLength(201);
    expect(pendingReport).toHaveBeenNthCalledWith(1, { page: 1, per_page: 100 }, expect.anything());
    expect(pendingReport).toHaveBeenNthCalledWith(3, { page: 3, per_page: 100 }, expect.anything());
  });
});
