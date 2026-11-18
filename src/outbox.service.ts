import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OutboxNotificacion } from './entities';
import { NotificationsClient } from './integrations';
import { SsoServiceTokenService } from './sso-service-token.service';

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name); private timer?: NodeJS.Timeout;
  constructor(@InjectRepository(OutboxNotificacion) private readonly outbox: Repository<OutboxNotificacion>, private readonly notifications: NotificationsClient, private readonly config: ConfigService, private readonly ssoToken: SsoServiceTokenService) {}
  onModuleInit() { this.timer = setInterval(() => void this.dispatchDue(), 30_000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  /** When clinical work supplies a manager, the durable notification is committed or rolled back with it. */
  async enqueue(personaId: string, menorId: string | null, finalidad: string, variables: Record<string, string>, key: string, mensaje?: { titulo: string; contenido: string }, manager?: EntityManager) {
    const repository = manager?.getRepository(OutboxNotificacion) ?? this.outbox;
    const exists = await repository.exist({ where: { idempotency_key: key } });
    if (!exists) await repository.insert({ persona_id: personaId, menor_id: menorId, finalidad, idempotency_key: key, payload: JSON.stringify({ variables, mensaje }), estado: 'PENDIENTE', intentos: 0, procesado_at: null, ultimo_error: null, created_by_persona_id: null, updated_by_persona_id: null, version: 1 });
  }
  async dispatchDue() {
    const items = await this.outbox.find({ where: { estado: 'PENDIENTE' }, order: { id: 'ASC' }, take: 20 });
    if (!items.length) return;
    let token: string;
    try { token = await this.ssoToken.get(); }
    catch { this.logger.warn('No se pudo obtener una sesión técnica de SSO para la outbox.'); return; }
    for (const item of items) await this.dispatch(item, `Bearer ${token}`);
  }
  /** Contacts are never read or persisted by SCCVI: Notificaciones resolves them from SSO. */
  private async dispatch(item: OutboxNotificacion, token: string) { const max = Number(this.config.get('OUTBOX_MAX_ATTEMPTS', 5)); try { const values = JSON.parse(item.payload) as { variables: Record<string, string>; mensaje?: { titulo: string; contenido: string } }; await this.notifications.enqueue({ tipo: item.finalidad, idempotencia: item.idempotency_key, canales: ['EMAIL', 'WHATSAPP'], mensaje: values.mensaje ?? { titulo: 'Recordatorio de vacunación', contenido: 'Tiene una dosis de vacunación pendiente.' }, destinatarios: [{ persona_id: item.persona_id, referenciaExterna: item.persona_id, variables: values.variables }] }, token); item.estado = 'ENVIADA'; item.procesado_at = new Date(); item.ultimo_error = null; await this.outbox.save(item); } catch (error) { item.intentos += 1; item.ultimo_error = error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido'; if (item.intentos >= max) item.estado = 'FALLIDA'; await this.outbox.save(item); this.logger.warn(`Outbox ${item.id} failed without affecting clinical data.`); } }
}
