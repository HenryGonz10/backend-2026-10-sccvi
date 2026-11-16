import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SsoServiceTokenService {
  private cached?: { token: string; expiresAt: number };
  private refreshing?: Promise<string>;

  constructor(private readonly config: ConfigService) {}

  async get(): Promise<string> {
    const username = this.config.get<string>('SSO_SERVICE_USERNAME');
    const password = this.config.get<string>('SSO_SERVICE_PASSWORD');
    if (!username || !password) {
      const token = this.config.get<string>('SSO_SERVICE_TOKEN');
      if (!token) throw new ServiceUnavailableException('SCCVI requiere una credencial de servicio de SSO.');
      return token;
    }
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.token;
    if (this.refreshing) return this.refreshing;

    this.refreshing = this.refresh(username, password);
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  private async refresh(username: string, password: string): Promise<string> {
    const base = this.config.get<string>('SSO_BASE_URL');
    if (!base) throw new ServiceUnavailableException('SSO_BASE_URL no está configurado.');
    const url = new URL(base);
    const response = await fetch(`${url.origin}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', System: this.config.get<string>('SSO_SYSTEM_TAG', 'sccvi') },
      body: JSON.stringify({ email: username, password }),
    });
    const body = await response.json() as { valid?: boolean; data?: { token?: string; expires_at?: string } };
    if (!response.ok || !body.valid || !body.data?.token) {
      throw new ServiceUnavailableException('No fue posible renovar la sesión técnica con SSO.');
    }
    const expires = Date.parse(body.data.expires_at ?? '');
    this.cached = {
      token: body.data.token,
      expiresAt: Number.isFinite(expires) ? expires : Date.now() + 10 * 60_000,
    };
    return this.cached.token;
  }
}
