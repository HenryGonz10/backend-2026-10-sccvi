import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { IS_PUBLIC } from './public.decorator';

export type SccviPrincipal = { userId: string; personaId?: string; scopes: string[]; roles: string[]; permissions?: string[]; territory?: { departamento_codigo?: string; municipio_codigo?: string }; payload: JWTPayload };

@Injectable()
export class SsoJwtGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  constructor(private readonly config: ConfigService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; principal?: SccviPrincipal }>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    try { request.principal = token ? await this.fromJwt(token) : await this.fromPortalSession(request.headers.cookie); return true; } catch { throw new UnauthorizedException('Sesión SSO inválida o expirada.'); }
  }

  private async fromJwt(token: string): Promise<SccviPrincipal> {
    const { payload } = await jwtVerify(token, this.verificationKey(), { clockTolerance: 5, algorithms: ['RS256'] });
    const scopes = String(payload.scope ?? '').split(' ').filter(Boolean); const roles = this.roleNames(payload.roles); const userId = String(payload.sub ?? '');
    if (!/^\d+$/.test(userId)) throw new Error('JWT subject is not a SSO user identifier.');
    const persona = payload.persona_id;
    return { userId, personaId: typeof persona === 'string' && /^\d+$/.test(persona) ? persona : undefined, scopes, roles: roles.length ? roles : await this.rolesFromContext(token), permissions: this.permissionNames(payload.roles), payload };
  }

  private async fromPortalSession(cookie?: string): Promise<SccviPrincipal> {
    if (!cookie) throw new Error('Missing SSO portal cookie.'); const base = this.config.getOrThrow<string>('SSO_BASE_URL');
    const response = await fetch(new URL('auth/session/me', base.endsWith('/') ? base : `${base}/`), { headers: { Accept: 'application/json', Cookie: cookie, System: this.config.get<string>('SSO_SYSTEM_TAG', 'sccvi') } });
    const body = await response.json().catch(() => null) as { valid?: boolean; data?: { id?: string | number; persona_id?: string | number; roles?: unknown; authorization_context?: unknown } } | null; const data = body?.data;
    if (!response.ok || !body?.valid || !data || !/^\d+$/.test(String(data.id ?? ''))) throw new Error('Invalid SSO portal session.');
    const persona = String(data.persona_id ?? ''); return { userId: String(data.id), personaId: /^\d+$/.test(persona) ? persona : undefined, scopes: [], roles: this.roleNames(data.roles), permissions: this.permissionNames(data.roles), territory: this.territoryFromContext(data.authorization_context), payload: { sub: String(data.id) } as JWTPayload };
  }

  private async rolesFromContext(token: string): Promise<string[]> {
    const base = this.config.getOrThrow<string>('SSO_BASE_URL'); const response = await fetch(new URL('auth/context', base.endsWith('/') ? base : `${base}/`), { headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, System: this.config.get<string>('SSO_SYSTEM_TAG', 'sccvi') } });
    const body = await response.json().catch(() => null) as { valid?: boolean; data?: { roles?: unknown } } | null; return response.ok && body?.valid ? this.roleNames(body.data?.roles) : [];
  }

  private roleNames(value: unknown): string[] { if (!Array.isArray(value)) return []; return value.flatMap(role => typeof role === 'string' ? [role] : role && typeof role === 'object' ? [typeof (role as { tag?: unknown }).tag === 'string' ? (role as { tag: string }).tag : null, typeof (role as { nombre?: unknown }).nombre === 'string' ? (role as { nombre: string }).nombre : null].filter((name): name is string => name !== null) : []); }
  private territoryFromContext(value: unknown): { departamento_codigo?: string; municipio_codigo?: string } | undefined { if (!value || typeof value !== 'object') return undefined; const context = value as { default_selection?: { assignment_tag?: unknown }; memberships?: unknown }; if (!Array.isArray(context.memberships)) return undefined; const preferred = context.memberships.find(item => item && typeof item === 'object' && (item as { assignment_tag?: unknown }).assignment_tag === context.default_selection?.assignment_tag) ?? context.memberships[0]; const territory = preferred && typeof preferred === 'object' ? (preferred as { territory?: unknown }).territory : undefined; if (!territory || typeof territory !== 'object') return undefined; const department = (territory as { departamento_codigo?: unknown }).departamento_codigo; const municipality = (territory as { municipio_codigo?: unknown }).municipio_codigo; return { ...(typeof department === 'string' ? { departamento_codigo: department } : {}), ...(typeof municipality === 'string' ? { municipio_codigo: municipality } : {}) };
  }
  private permissionNames(value: unknown): string[] { if (!Array.isArray(value)) return []; return value.flatMap(role => role && typeof role === 'object' && Array.isArray((role as { permisos?: unknown }).permisos) ? (role as { permisos: unknown[] }).permisos.flatMap(permission => typeof permission === 'string' ? [permission] : permission && typeof permission === 'object' && typeof (permission as { nombre?: unknown }).nombre === 'string' ? [(permission as { nombre: string }).nombre] : []) : []); }
  private verificationKey() { return this.jwks ??= createRemoteJWKSet(new URL(this.config.getOrThrow<string>('SSO_JWKS_URI')), { timeoutDuration: Number(this.config.get('SSO_TIMEOUT_MS', 2500)) }); }
}

/** The role aliases preserve SSO as source of truth while SCCVI receives a compact capability name. */
export const requireScope = (principal: SccviPrincipal, ...allowed: string[]): void => {
  const aliases: Record<string, string[]> = {
    'sccvi.admin': ['SCCVI_ADMIN'],
    'sccvi.clinical': ['SCCVI_ADMIN', 'SCCVI_DDRISS', 'SCCVI_ESTABLECIMIENTO'],
    'sccvi.read': ['SCCVI_ADMIN', 'SCCVI_DDRISS', 'SCCVI_ESTABLECIMIENTO', 'SCCVI_CONSULTA'],
    'sso.admin': ['Administrador'],
  };
  const permissionAliases: Record<string, string[]> = { 'sccvi.admin': ['CATALOGOS.ADMINISTRAR'], 'sccvi.clinical': ['PACIENTES.CREAR', 'PACIENTES.EDITAR', 'CRECIMIENTO.CREAR', 'VACUNACION.CREAR', 'JORNADAS.CREAR'], 'sccvi.read': ['PERSONAS.VER', 'PACIENTES.VER', 'REPORTES.VER'] };
  const permissions = principal.permissions ?? [];
  if (!allowed.some(scope => principal.scopes.includes(scope) || principal.roles.includes(scope) || permissions.includes(scope) || (aliases[scope] ?? []).some(role => principal.roles.includes(role)) || (permissionAliases[scope] ?? []).some(permission => permissions.includes(permission)))) throw new ForbiddenException('No tienes permiso para esta operación SCCVI.');
};
