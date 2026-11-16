import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SccviService } from './sccvi.service';

/** Runs at 16:00 America/Guatemala (UTC-6, without daylight saving time). */
@Injectable()
export class CampaignReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignReminderService.name); private timer?: NodeJS.Timeout;
  constructor(private readonly sccvi: SccviService) {}
  onModuleInit() { this.schedule(); }
  onModuleDestroy() { if (this.timer) clearTimeout(this.timer); }
  private schedule() {
    const now = new Date(); const utcTarget = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 22, 0, 0));
    if (utcTarget <= now) utcTarget.setUTCDate(utcTarget.getUTCDate() + 1);
    this.timer = setTimeout(async () => { try { await this.sccvi.processDailyReminders(); } catch (error) { this.logger.error(`No se pudieron preparar recordatorios: ${error instanceof Error ? error.message : 'error desconocido'}`); } finally { this.schedule(); } }, utcTarget.getTime() - now.getTime());
    this.timer.unref();
  }
}
