import { GeoClient, NotificationsClient, SsoClient } from './integrations';
import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';

describe('SCCVI integration clients', () => {
  const config = { get: jest.fn((key: string, fallback?: unknown) => ({ GEO_TIMEOUT_MS: 1, SSO_TIMEOUT_MS: 1, SSO_SYSTEM_TAG: 'sccvi' }[key] ?? fallback)), getOrThrow: jest.fn((key: string) => ({ GEO_BASE_URL: 'http://geo.test/api/v1', NOTIFICATIONS_BASE_URL: 'http://notifications.test/api/v1', SSO_BASE_URL: 'http://sso.test/api/v1' }[key])) } as any;
  const nativeFetch = global.fetch;
  afterEach(() => { global.fetch = nativeFetch; jest.restoreAllMocks(); });

  it('preserves the versioned Geo base URL and checks municipality/community consistency', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ valid: true, data: { codigo: '0101' }, msg: 'ok' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ valid: true, data: { municipio_codigo: '0101' }, msg: 'ok' }) });
    global.fetch = fetchMock as any;
    await new GeoClient(config).validateLocation('01', '0101', 'b4df7f6f-3eb5-4db0-a1c9-4e0fd0eb92e9');
    expect(fetchMock.mock.calls[0][0].toString()).toBe('http://geo.test/api/v1/municipios/0101');
    expect(fetchMock.mock.calls[1][0].toString()).toContain('/api/v1/comunidades/');
  });

  it('does not let a path discard the notifications API version', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true }); global.fetch = fetchMock as any;
    await new NotificationsClient(config).enqueue({ tipo: 'SCCVI_RECORDATORIO' }, 'token');
    expect(fetchMock.mock.calls[0][0].toString()).toBe('http://notifications.test/api/v1/envios');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
  });

  it('pages SSO residents in a geographic broadcast scope', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, data: [{ persona_id: '1', ncompleto: 'Uno' }], msg: 'ok', meta: { last_page: 2 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, data: [{ persona_id: '2', ncompleto: 'Dos' }], msg: 'ok', meta: { last_page: 2 } }) });
    global.fetch = fetchMock as any;
    await expect(new SsoClient(config).residents({ departamento_codigo: '16', municipio_codigo: '1601' }, 'token')).resolves.toMatchObject([{ persona_id: '1' }, { persona_id: '2' }]);
    expect(fetchMock.mock.calls[0][0].toString()).toContain('departamento_codigo=16');
    expect(fetchMock.mock.calls[1][0].toString()).toContain('page=2');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
  });

  it('rejects an invalid SSO envelope instead of accepting untrusted identity data', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: false, data: [], msg: 'rejected' }) }) as any;
    await expect(new SsoClient(config).search({ q: 'maria' }, 'token')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('maps an aborted Geo request to a controlled service-unavailable error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network timeout')) as any;
    await expect(new GeoClient(config).validateLocation('16', '1601')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not report notification delivery when the producer returns an error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as any;
    await expect(new NotificationsClient(config).enqueue({ tipo: 'SCCVI_RECORDATORIO' }, 'token')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
