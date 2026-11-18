import { ExecutionContext, HttpException } from '@nestjs/common';
import { PublicCardRateLimitGuard } from './public-card-rate-limit.guard';

const context = (ip: string, token: string) => ({ switchToHttp: () => ({ getRequest: () => ({ ip, params: { token } }) }) }) as unknown as ExecutionContext;

describe('PublicCardRateLimitGuard', () => {
  it('limits the public PIN/card surface by the combination of IP and opaque token', () => {
    const guard = new PublicCardRateLimitGuard(); Object.assign(guard as unknown as { limit: number; windowMs: number }, { limit: 2, windowMs: 60_000 });
    expect(guard.canActivate(context('198.51.100.10', 'opaque-a'))).toBe(true);
    expect(guard.canActivate(context('198.51.100.10', 'opaque-a'))).toBe(true);
    expect(() => guard.canActivate(context('198.51.100.10', 'opaque-a'))).toThrow(HttpException);
    expect(guard.canActivate(context('198.51.100.10', 'opaque-b'))).toBe(true);
    expect(guard.canActivate(context('198.51.100.11', 'opaque-a'))).toBe(true);
  });
});
