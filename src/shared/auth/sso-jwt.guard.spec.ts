import { ForbiddenException } from '@nestjs/common';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { SsoJwtGuard, requireScope, type SccviPrincipal } from './sso-jwt.guard';

const principal = (scopes: string[]): SccviPrincipal => ({ userId: '1', personaId: '2', scopes, roles: [], payload: { sub: '1' } });

describe('SCCVI permissions', () => {
  it('requires an explicitly granted clinical/admin scope', () => { expect(() => requireScope(principal([]), 'sccvi.clinical')).toThrow(ForbiddenException); expect(() => requireScope(principal(['sccvi.clinical']), 'sccvi.clinical')).not.toThrow(); });
  it('maps the read-only SCCVI role without granting clinical writes', () => { const reader = { ...principal([]), roles: ['SCCVI_CONSULTA'] }; expect(() => requireScope(reader, 'sccvi.read')).not.toThrow(); expect(() => requireScope(reader, 'sccvi.clinical')).toThrow(ForbiddenException); });
  it('does not translate an SSO portal role into an SCCVI permission', () => { const administrator = { ...principal([]), roles: ['Administrador'] }; expect(() => requireScope(administrator, 'sccvi.read')).toThrow(ForbiddenException); expect(() => requireScope(administrator, 'sccvi.admin')).toThrow(ForbiddenException); });
  it('maps an SSO HTTP-only portal session to an opaque persona reference', async () => {
    const nativeFetch = global.fetch; global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: true, data: { id: '7', persona_id: '11', roles: [{ tag: 'sccvi.clinical' }] } }) }) as any;
    try { const guard = new SsoJwtGuard({ getOrThrow: jest.fn().mockReturnValue('http://sso.test/api/v1'), get: jest.fn((key: string, fallback?: unknown) => key === 'SSO_SYSTEM_TAG' ? 'sccvi' : fallback) } as any, {} as any); await expect((guard as any).fromPortalSession('sso_access=opaque')).resolves.toMatchObject({ userId: '7', personaId: '11', roles: ['sccvi.clinical'], ssoSessionCookie: 'sso_access=opaque' }); expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toBe('http://sso.test/api/v1/auth/session/me'); } finally { global.fetch = nativeFetch; }
  });
});

describe('SCCVI JWT validation', () => {
  it('selects the JWKS key by kid instead of trusting the first published key', async () => {
    const active = await generateKeyPair('RS256'); const other = await generateKeyPair('RS256');
    const activeJwk = await exportJWK(active.publicKey); activeJwk.kid = 'active'; activeJwk.alg = 'RS256';
    const otherJwk = await exportJWK(other.publicKey); otherJwk.kid = 'other'; otherJwk.alg = 'RS256';
    const server = createServer((_, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ keys: [otherJwk, activeJwk] })); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const token = await new SignJWT({ persona_id: '22', scope: 'sccvi.clinical' }).setProtectedHeader({ alg: 'RS256', kid: 'active' }).setSubject('7').setIssuedAt().setExpirationTime('5m').sign(active.privateKey);
      const guard = new SsoJwtGuard({ getOrThrow: jest.fn().mockReturnValue(`http://127.0.0.1:${port}/jwks`), get: jest.fn((_: string, fallback?: unknown) => fallback) } as any, {} as any);
      await expect((guard as any).fromJwt(token)).resolves.toMatchObject({ userId: '7', personaId: '22', scopes: ['sccvi.clinical'] });
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
