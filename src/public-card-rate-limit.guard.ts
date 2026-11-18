import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

type Window = { count: number; resetAt: number };

/**
 * Keeps an inexpensive perimeter limit before Argon2 verification. The durable
 * five-failure lock remains the authoritative per-card defence in the service.
 */
@Injectable()
export class PublicCardRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();
  private limit = 10;
  private windowMs = 60_000;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ ip?: string; socket?: { remoteAddress?: string }; params?: { token?: string } }>();
    const token = request.params?.token ?? 'missing-token';
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown-ip';
    const now = Date.now(); const key = `${ip}:${token}`;
    for (const [candidate, value] of this.windows) if (value.resetAt <= now) this.windows.delete(candidate);
    const current = this.windows.get(key);
    if (current && current.count >= this.limit) throw new HttpException('Demasiados intentos. Espera antes de volver a intentar.', HttpStatus.TOO_MANY_REQUESTS);
    this.windows.set(key, { count: (current?.count ?? 0) + 1, resetAt: current?.resetAt ?? now + this.windowMs });
    return true;
  }
}
