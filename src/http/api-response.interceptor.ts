import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { isApiEnvelope, success } from './api-envelope';

type PagePayload = { items: unknown[]; meta: { current_page: number; per_page: number; total: number; last_page: number } };
const isPagePayload = (value: unknown): value is PagePayload => typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items) && typeof (value as { meta?: unknown }).meta === 'object';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const response = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
    // Business responses can depend on portal-session cookies. Never reuse a
    // previous user's envelope after a new SSO login or logout.
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Pragma', 'no-cache');
    const correlationId = request.headers['x-correlation-id'] ?? request.headers['x-request-id'];
    return next.handle().pipe(map(payload => {
      if (isApiEnvelope(payload)) return payload;
      if (isPagePayload(payload)) return success(payload.items, 'Operación completada.', { meta: payload.meta, ...(correlationId ? { correlationId } : {}) });
      return success(payload, 'Operación completada.', correlationId ? { correlationId } : undefined);
    }));
  }
}
