import { ConflictException } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('SCCVI exception envelope', () => {
  it('writes business failures through the Express response adapter', () => {
    const json = jest.fn(); const status = jest.fn().mockReturnValue({ json }); const setHeader = jest.fn();
    const host = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-request-id': 'request-1' } }), getResponse: () => ({ status, setHeader }) }) };
    new ApiExceptionFilter().catch(new ConflictException('Versión obsoleta.'), host as any);
    expect(status).toHaveBeenCalledWith(409);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
    expect(json).toHaveBeenCalledWith({ valid: false, data: null, msg: 'Versión obsoleta.', code: 'CONFLICT', correlationId: 'request-1' });
  });
  it('normalizes unknown exceptions as an envelope with HTTP 500', () => {
    const json = jest.fn(); const status = jest.fn().mockReturnValue({ json }); const setHeader = jest.fn();
    const host = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }), getResponse: () => ({ status, setHeader }) }) };
    new ApiExceptionFilter().catch(new Error('secret'), host as any);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ valid: false, data: null, msg: 'Error interno del servicio.', code: 'INTERNAL_ERROR' }));
  });
});
