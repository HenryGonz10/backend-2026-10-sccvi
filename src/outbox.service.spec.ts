import { OutboxService } from './outbox.service';

describe('SCCVI outbox', () => {
  it('inserts a reminder once for the same idempotency key', async () => {
    const repo = { exist: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true), insert: jest.fn().mockResolvedValue({}), find: jest.fn(), save: jest.fn() };
    const service = new OutboxService(repo as any, {} as any, {} as any, {} as any);
    await service.enqueue('44', '10', 'SCCVI_RECORDATORIO', { menor_id: '10' }, 'alerta:1');
    await service.enqueue('44', '10', 'SCCVI_RECORDATORIO', { menor_id: '10' }, 'alerta:1');
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ persona_id: '44', menor_id: '10', idempotency_key: 'alerta:1' }));
  });
  it('sends only the SSO persona reference to Notifications and marks one idempotent row sent', async () => {
    const item: any = { id: '1', persona_id: '44', menor_id: '10', finalidad: 'SCCVI_RECORDATORIO', idempotency_key: 'alerta:1', payload: JSON.stringify({ variables: { menor_id: '10' } }), estado: 'PENDIENTE', intentos: 0 };
    const repo = { find: jest.fn().mockResolvedValue([item]), save: jest.fn().mockResolvedValue(item), exist: jest.fn(), insert: jest.fn() };
    const notifications = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn((_: string, fallback?: unknown) => fallback) };
    const ssoToken = { get: jest.fn().mockResolvedValue('service-token') };
    const service = new OutboxService(repo as any, notifications as any, config as any, ssoToken as any);
    await service.dispatchDue();
    expect(notifications.enqueue).toHaveBeenCalledWith(expect.objectContaining({ destinatarios: [expect.objectContaining({ persona_id: '44', referenciaExterna: '44', variables: { menor_id: '10' } })] }), 'Bearer service-token');
    expect(notifications.enqueue.mock.calls[0][0].destinatarios[0]).not.toHaveProperty('contactos');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ estado: 'ENVIADA' }));
  });
  it('does not request a technical SSO session when there is no pending delivery', async () => {
    const repo = { find: jest.fn().mockResolvedValue([]), save: jest.fn(), exist: jest.fn(), insert: jest.fn() };
    const ssoToken = { get: jest.fn() };
    const service = new OutboxService(repo as any, {} as any, {} as any, ssoToken as any);
    await service.dispatchDue();
    expect(ssoToken.get).not.toHaveBeenCalled();
  });
});
