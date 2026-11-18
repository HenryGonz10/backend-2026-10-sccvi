import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { createConnection } from 'net';

type RedisReply = string | number | null | RedisReply[];

export interface PublicCardRateLimitStore { consume(ip: string, token: string, ipLimit: number, tokenLimit: number, windowMs: number): Promise<boolean>; }

/** Minimal RESP client keeps the public perimeter independent from a process-local cache. */
class RedisPublicCardRateLimitStore implements PublicCardRateLimitStore {
  constructor(private readonly url: string) {}
  async consume(ip: string, token: string, ipLimit: number, tokenLimit: number, windowMs: number) {
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    const ipKey = `sccvi:public-card:ip:${digest(ip)}`; const pairKey = `sccvi:public-card:pair:${digest(`${ip}:${token}`)}`;
    const script = "local a=redis.call('INCR',KEYS[1]); if a==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; local b=redis.call('INCR',KEYS[2]); if b==1 then redis.call('PEXPIRE',KEYS[2],ARGV[1]) end; return {a,b}";
    const reply = await this.command(['EVAL', script, '2', ipKey, pairKey, String(windowMs)]);
    if (!Array.isArray(reply) || typeof reply[0] !== 'number' || typeof reply[1] !== 'number') throw new Error('Redis returned an invalid rate-limit response.');
    return reply[0] <= ipLimit && reply[1] <= tokenLimit;
  }
  private async command(args: string[]): Promise<RedisReply> {
    const target = new URL(this.url); const port = Number(target.port || 6379); const database = target.pathname.replace('/', '') || '0';
    const commands = [...(target.password ? [['AUTH', decodeURIComponent(target.username || 'default'), decodeURIComponent(target.password)]] : []), ['SELECT', database], args];
    const socket = createConnection({ host: target.hostname, port }); let buffer = Buffer.alloc(0); const replies: RedisReply[] = [];
    return new Promise<RedisReply>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Redis rate-limit timeout.')), 1_500);
      const finish = (error?: Error, result?: RedisReply) => { clearTimeout(timeout); socket.destroy(); if (error) reject(error); else resolve(result as RedisReply); };
      socket.once('error', error => finish(error));
      socket.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); for (;;) { const parsed = parseResp(buffer); if (!parsed) return; buffer = buffer.subarray(parsed.bytes); replies.push(parsed.value); if (replies.length === commands.length) { const last = replies.at(-1); if (typeof last === 'string' && last.startsWith('ERR ')) return finish(new Error(last)); return finish(undefined, last); } } });
      socket.once('connect', () => socket.write(Buffer.concat(commands.map(command => encodeResp(command)))));
    });
  }
}

const encodeResp = (parts: string[]) => Buffer.from(`*${parts.length}\r\n${parts.map(value => `$${Buffer.byteLength(value)}\r\n${value}\r\n`).join('')}`);
const parseResp = (input: Buffer): { value: RedisReply; bytes: number } | undefined => {
  const lineEnd = input.indexOf('\r\n'); if (lineEnd < 0) return undefined;
  const kind = String.fromCharCode(input[0]); const header = input.subarray(1, lineEnd).toString(); const offset = lineEnd + 2;
  if (kind === '+' || kind === '-') return { value: kind === '-' ? `ERR ${header}` : header, bytes: offset };
  if (kind === ':') return { value: Number(header), bytes: offset };
  if (kind === '$') { const size = Number(header); if (size === -1) return { value: null, bytes: offset }; if (input.length < offset + size + 2) return undefined; return { value: input.subarray(offset, offset + size).toString(), bytes: offset + size + 2 }; }
  if (kind === '*') { const size = Number(header); if (size === -1) return { value: null, bytes: offset }; const values: RedisReply[] = []; let bytes = offset; for (let index = 0; index < size; index += 1) { const next = parseResp(input.subarray(bytes)); if (!next) return undefined; values.push(next.value); bytes += next.bytes; } return { value: values, bytes }; }
  throw new Error('Unsupported Redis RESP reply.');
};

/** Distributed, atomic Redis limiter. Redis failure is fail-closed: the public
 * card/PIN surface never silently downgrades to process-local rate limiting. */
@Injectable()
export class PublicCardRateLimitGuard implements CanActivate {
  private readonly store: PublicCardRateLimitStore;
  private limit = 10; private ipLimit = 30; private windowMs = 60_000;
  constructor(@Optional() config?: ConfigService) {
    const url = config?.get<string>('PUBLIC_CARD_RATE_LIMIT_REDIS_URL') ?? process.env.PUBLIC_CARD_RATE_LIMIT_REDIS_URL ?? 'redis://redis:6379/3';
    this.store = new RedisPublicCardRateLimitStore(url);
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ ip?: string; socket?: { remoteAddress?: string }; params?: { token?: string } }>();
    const token = request.params?.token ?? 'missing-token'; const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown-ip';
    try { if (!await this.store.consume(ip, token, this.ipLimit, this.limit, this.windowMs)) throw new HttpException('Demasiados intentos. Espera antes de volver a intentar.', HttpStatus.TOO_MANY_REQUESTS); }
    catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException('El control de acceso público no está disponible temporalmente.'); }
    return true;
  }
}
