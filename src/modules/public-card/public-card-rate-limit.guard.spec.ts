import { ExecutionContext, HttpException } from '@nestjs/common';
import { PublicCardRateLimitGuard } from './public-card-rate-limit.guard';

const context = (ip: string, token: string) => ({ switchToHttp: () => ({ getRequest: () => ({ ip, params: { token } }) }) }) as unknown as ExecutionContext;

describe('PublicCardRateLimitGuard', () => {
  it('limits the public PIN/card surface by the combination of IP and opaque token', async () => {
    const guard = new PublicCardRateLimitGuard(); Object.assign(guard as unknown as { limit: number; windowMs: number }, { limit: 2, windowMs: 60_000 });
    const windows = new Map<string, number>();
    Object.assign(guard as unknown as { store: { consume: (ip: string, token: string, ipLimit: number, tokenLimit: number) => Promise<boolean> } }, {
      store: { consume: async (ip: string, token: string, ipLimit: number, tokenLimit: number) => {
        const ipKey = `ip:${ip}`; const pairKey = `${ipKey}:${token}`;
        const ipCount = (windows.get(ipKey) ?? 0) + 1; const pairCount = (windows.get(pairKey) ?? 0) + 1;
        windows.set(ipKey, ipCount); windows.set(pairKey, pairCount);
        return ipCount <= ipLimit && pairCount <= tokenLimit;
      } },
    });
    await expect(guard.canActivate(context('198.51.100.10', 'opaque-a'))).resolves.toBe(true);
    await expect(guard.canActivate(context('198.51.100.10', 'opaque-a'))).resolves.toBe(true);
    await expect(guard.canActivate(context('198.51.100.10', 'opaque-a'))).rejects.toBeInstanceOf(HttpException);
    await expect(guard.canActivate(context('198.51.100.10', 'opaque-b'))).resolves.toBe(true);
    await expect(guard.canActivate(context('198.51.100.11', 'opaque-a'))).resolves.toBe(true);
  });
});
