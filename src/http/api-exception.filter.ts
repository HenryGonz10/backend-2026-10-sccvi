import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { failure } from './api-envelope';

type ExpressReply = { setHeader(name: string, value: string): void; status(status: number): { json(body: unknown): void } };
type FastifyReply = { header(name: string, value: string): void; code(status: number): { send(body: unknown): void } };

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ headers: Record<string, string | undefined> }>();
    const response = ctx.getResponse<ExpressReply & FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const detail = body.message ?? raw;
    const errors = Array.isArray(detail) ? detail : undefined;
    const msg = errors ? 'Error de validación.' : typeof detail === 'string' ? detail : 'Error interno del servicio.';
    const code = status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : status === 422 ? 'VALIDATION_ERROR' : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
    const envelope = failure(msg, null, { code, ...(errors ? { errors } : {}), ...((request.headers['x-correlation-id'] ?? request.headers['x-request-id']) ? { correlationId: request.headers['x-correlation-id'] ?? request.headers['x-request-id'] } : {}) });
    if (typeof response.status === 'function') {
      response.setHeader('Cache-Control', 'no-store, private');
      response.setHeader('Pragma', 'no-cache');
      return response.status(status).json(envelope);
    }
    response.header('Cache-Control', 'no-store, private');
    response.header('Pragma', 'no-cache');
    response.code(status).send(envelope);
  }
}
