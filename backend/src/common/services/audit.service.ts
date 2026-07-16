import { Injectable, Logger } from '@nestjs/common';

export interface AuditEvent {
  action: string;
  actorId?: number;
  targetType?: string;
  targetId?: number;
  metadata?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  async record(event: AuditEvent): Promise<void> {
    this.logger.log({ ...event, timestamp: new Date().toISOString() });
  }
}
