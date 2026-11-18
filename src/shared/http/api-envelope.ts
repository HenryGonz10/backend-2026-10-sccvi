export type ApiEnvelope<T = unknown> = { valid: boolean; data: T; msg: string; meta?: Record<string, unknown>; errors?: unknown; code?: string; correlationId?: string };
type Extras = Omit<Partial<ApiEnvelope>, 'valid' | 'data' | 'msg'>;
const reserved = new Set(['valid', 'data', 'msg']);
const extras = (value?: Extras): Extras => { for (const key of Object.keys(value ?? {})) if (reserved.has(key)) throw new Error(`No se puede sobrescribir ${key}.`); return value ?? {}; };
export const success = <T>(data: T, msg = 'Operación completada.', value?: Extras): ApiEnvelope<T> => ({ valid: true, data, msg, ...extras(value) });
export const failure = (msg: string, data: unknown = null, value?: Extras): ApiEnvelope => ({ valid: false, data, msg, ...extras(value) });
export const isApiEnvelope = (value: unknown): value is ApiEnvelope => Boolean(value) && typeof value === 'object' && ['valid', 'data', 'msg'].every((key) => Object.hasOwn(value as object, key));
