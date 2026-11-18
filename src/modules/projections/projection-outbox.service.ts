import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as amqp from 'amqplib';
import { Repository } from 'typeorm';
import { OutboxProyeccion } from '../../shared/persistence/entities';
import { SccviReadProjectionService } from './read-projection.service';

/**
 * SQL is the source of truth. A row is persisted before publishing to RabbitMQ,
 * so a Rabbit outage cannot lose a requested read-model refresh. The consumer
 * projects by minor id, which makes repeated deliveries harmless.
 */
@Injectable()
export class ProjectionOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectionOutboxService.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.ConfirmChannel;
  private timer?: NodeJS.Timeout;
  private connecting?: Promise<void>;
  private pumping = false;
  private pendingDeliveries: amqp.ConsumeMessage[] = [];
  private flushTimer?: NodeJS.Timeout;
  private flushing = false;
  private readonly exchange = 'sccvi.projections';
  private readonly queue = 'sccvi.projections.v1';
  /** A transient SSO/Geo outage must not turn Rabbit redelivery into a retry storm. */
  private readonly retryDelayMs = Math.max(1_000, Number(process.env.PROJECTION_RETRY_DELAY_MS ?? 60_000));

  constructor(
    @InjectRepository(OutboxProyeccion) private readonly outbox: Repository<OutboxProyeccion>,
    private readonly readProjection: SccviReadProjectionService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() { this.timer = setInterval(() => void this.pump(), 1000); void this.pump(); }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); if (this.flushTimer) clearTimeout(this.flushTimer); await this.connection?.close().catch(() => undefined); }

  async enqueue(minorId: string): Promise<void> {
    const key = `minor:${minorId}:refresh`;
    if (!await this.outbox.exist({ where: { idempotency_key: key, estado: 'PENDIENTE' } })) {
      await this.outbox.upsert({ menor_id: minorId, idempotency_key: key, estado: 'PENDIENTE', intentos: 0, publicado_at: null, ultimo_error: null, created_by_persona_id: null, updated_by_persona_id: null, version: 1 }, ['idempotency_key']);
    }
    void this.pump();
  }

  private async connect(): Promise<void> {
    if (this.channel) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const url = this.config.get<string>('RABBITMQ_URL');
      if (!url) throw new Error('RABBITMQ_URL is not configured.');
      const connection = await amqp.connect(url);
      connection.on('close', () => { this.connection = undefined; this.channel = undefined; });
      connection.on('error', () => undefined);
      const channel = await connection.createConfirmChannel();
      await channel.assertExchange(this.exchange, 'topic', { durable: true });
      await channel.assertQueue(this.queue, { durable: true });
      await channel.bindQueue(this.queue, this.exchange, 'minor.changed');
      // Coalesce fan-out before resolving people in SSO. A batch remains under
      // the resolver's 100-id contract and avoids a durable queue rate storm.
      await channel.prefetch(50);
      await channel.consume(this.queue, message => void this.consume(message), { noAck: false });
      this.connection = connection; this.channel = channel;
    })();
    try { await this.connecting; } finally { this.connecting = undefined; }
  }

  private async consume(message: amqp.ConsumeMessage | null): Promise<void> {
    if (!message || !this.channel) return;
    this.pendingDeliveries.push(message);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), 25);
  }

  private async flush(): Promise<void> {
    this.flushTimer = undefined;
    if (this.flushing || !this.channel) return;
    this.flushing = true;
    const deliveries = this.pendingDeliveries.splice(0, 100);
    try {
      const minorIds = deliveries.map(message => {
        const event = JSON.parse(message.content.toString()) as { minor_id?: string };
        if (!event.minor_id || !/^\d+$/.test(event.minor_id)) throw new Error('Invalid projection event.');
        return event.minor_id;
      });
      await this.readProjection.projectMany([...new Set(minorIds)]);
      deliveries.forEach(message => this.channel?.ack(message));
    } catch (error) {
      this.logger.warn(`Projection event will be retried: ${error instanceof Error ? error.message : 'unknown error'}`);
      const channel = this.channel;
      setTimeout(() => {
        // The channel may have been recreated while the delivery waited. In
        // that case Rabbit will restore the unacknowledged message itself.
        if (channel === this.channel) deliveries.forEach(message => channel.nack(message, false, true));
      }, this.retryDelayMs);
    } finally {
      this.flushing = false;
      if (this.pendingDeliveries.length && !this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), 25);
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      await this.connect();
      const rows = await this.outbox.find({ where: { estado: 'PENDIENTE' }, order: { id: 'ASC' }, take: 50 });
      for (const row of rows) {
        try {
          this.channel!.publish(this.exchange, 'minor.changed', Buffer.from(JSON.stringify({ event_id: row.id, minor_id: row.menor_id })), { persistent: true, messageId: row.id });
          await this.channel!.waitForConfirms();
          row.estado = 'PUBLICADA'; row.publicado_at = new Date(); row.ultimo_error = null;
          await this.outbox.save(row);
        } catch (error) {
          row.intentos += 1; row.ultimo_error = error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido';
          await this.outbox.save(row);
          throw error;
        }
      }
    } catch (error) {
      this.logger.warn(`RabbitMQ projection outbox pending: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally { this.pumping = false; }
  }
}
