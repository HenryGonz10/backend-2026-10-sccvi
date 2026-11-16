import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Envelope<T> = { valid: boolean; data: T; msg: string; meta?: { current_page?: number; last_page?: number } };
const endpoint = (base: string, path: string) => new URL(path, base.endsWith('/') ? base : `${base}/`);
const authorization = (token: string) => token.startsWith('Bearer ') ? token : `Bearer ${token}`;
export type SsoPerson = { persona_id: string; cui?: string; ncompleto: string; fecha_nacimiento?: string; sexo?: string; direccion_ref?: string | null; departamento_codigo?: string | null; municipio_codigo?: string | null; comunidad_ref?: string | null; contactos?: Array<{ canal: string; destino: string; estado: boolean }> };

@Injectable()
export class SsoClient {
  constructor(private readonly config: ConfigService) {}
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Number(this.config.get('SSO_TIMEOUT_MS', 2500)));
    try {
      const response = await fetch(endpoint(this.config.getOrThrow<string>('SSO_BASE_URL'), path), { ...init, signal: controller.signal, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
      const payload = await response.json().catch(() => null) as Envelope<T> | null;
      if (!response.ok || !payload?.valid) throw new BadGatewayException('SSO devolvió una respuesta inválida.');
      return payload.data;
    } catch (error) { if (error instanceof BadGatewayException) throw error; throw new ServiceUnavailableException('SSO no está disponible temporalmente.'); } finally { clearTimeout(timer); }
  }
  private async requestPage<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Number(this.config.get('SSO_TIMEOUT_MS', 2500)));
    try {
      const response = await fetch(endpoint(this.config.getOrThrow<string>('SSO_BASE_URL'), path), { ...init, signal: controller.signal, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
      const payload = await response.json().catch(() => null) as Envelope<T> | null;
      if (!response.ok || !payload?.valid) throw new BadGatewayException('SSO resident search returned an invalid response.');
      return payload;
    } catch (error) { if (error instanceof BadGatewayException) throw error; throw new ServiceUnavailableException('SSO is temporarily unavailable.'); } finally { clearTimeout(timer); }
  }
  private contextHeaders(token: string) { return { Authorization: authorization(token), System: this.config.get<string>('SSO_SYSTEM_TAG', 'sccvi') }; }
  resolvePeople(ids: string[], token: string) { return this.request<SsoPerson[]>('personas/resolver', { method: 'POST', headers: { ...this.contextHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ persona_ids: ids }) }); }
  createPerson(input: Record<string, unknown>, token: string, idempotencyKey: string) { return this.request<SsoPerson>('personas', { method: 'POST', headers: { ...this.contextHeaders(token), 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) }); }
  search(query: { cui?: string; q?: string; fecha_nacimiento?: string; page?: number; per_page?: number }, token: string) { const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])); return this.request<SsoPerson[]>(`personas?${params}`, { headers: this.contextHeaders(token) }); }
  async residents(scope: { departamento_codigo?: string | null; municipio_codigo?: string | null; comunidad_ref?: string | null }, token: string): Promise<SsoPerson[]> {
    const result: SsoPerson[] = []; let page = 1; let lastPage = 1;
    do {
      const params = new URLSearchParams(Object.entries({ ...scope, page, per_page: 100 }).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)]));
      const response = await this.requestPage<SsoPerson[]>(`personas?${params}`, { headers: this.contextHeaders(token) });
      result.push(...response.data); lastPage = Math.max(1, Number(response.meta?.last_page ?? 1)); page += 1;
    } while (page <= lastPage);
    return result;
  }
  contacts(personaId: string, token: string) { return this.request<Array<{ canal: string; destino: string; estado: boolean }>>(`personas/${personaId}/contactos`, { headers: this.contextHeaders(token) }); }
}

@Injectable()
export class GeoClient {
  constructor(private readonly config: ConfigService) {}
  private async request(path: string): Promise<unknown> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Number(this.config.get('GEO_TIMEOUT_MS', 2500)));
    try {
      const response = await fetch(endpoint(this.config.getOrThrow<string>('GEO_BASE_URL'), path), { headers: { Accept: 'application/json' }, signal: controller.signal });
      const payload = await response.json().catch(() => null) as Envelope<unknown> | null;
      if (response.status === 404) return null;
      if (!response.ok || !payload?.valid) throw new BadGatewayException('Geo devolvió una respuesta inválida.');
      return payload.data;
    } catch (error) { if (error instanceof BadGatewayException) throw error; throw new ServiceUnavailableException('Geo no está disponible temporalmente.'); } finally { clearTimeout(timer); }
  }
  async validateLocation(departamento?: string, municipio?: string, comunidad?: string) {
    if (!departamento && !municipio && !comunidad) return;
    if (!departamento || !municipio || !municipio.startsWith(departamento)) throw new BadGatewayException('La referencia geográfica es inconsistente.');
    if (!await this.request(`municipios/${encodeURIComponent(municipio)}`)) throw new BadGatewayException('El municipio indicado no existe en Geo.');
    if (comunidad) { const community = await this.request(`comunidades/${encodeURIComponent(comunidad)}`) as { municipio_codigo?: string } | null; if (!community || community.municipio_codigo !== municipio) throw new BadGatewayException('La comunidad no pertenece al municipio indicado.'); }
  }
}

@Injectable()
export class NotificationsClient {
  constructor(private readonly config: ConfigService) {}
  async enqueue(input: unknown, token: string): Promise<void> { const response = await fetch(endpoint(this.config.getOrThrow<string>('NOTIFICATIONS_BASE_URL'), 'envios'), { method: 'POST', headers: { Authorization: authorization(token), 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).catch(() => undefined); if (!response?.ok) throw new ServiceUnavailableException('Notificaciones no está disponible temporalmente.'); }
}
