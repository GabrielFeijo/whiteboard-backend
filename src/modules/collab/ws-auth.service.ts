import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { redisKeys } from '../../core/redis/redis-keys';
import { RedisService } from '../../core/redis/redis.service';
import { ROLES } from '../../shared';

export const TicketPayloadSchema = z.object({
  userId: z.string().min(1),
  userName: z.string().min(1),
  boardId: z.string().min(1),
  role: z.enum(ROLES),
  linkId: z.string().optional(),
});

export type TicketPayload = z.infer<typeof TicketPayloadSchema>;

@Injectable()
export class WsAuthService {
  constructor(private readonly redis: RedisService) {}

  async consumeTicket(ticket: string): Promise<TicketPayload | null> {
    if (!ticket) return null;

    const raw = await this.redis.client.call('GETDEL', redisKeys.wsTicket(ticket));
    if (!raw || typeof raw !== 'string') return null;

    try {
      const parsedJson: unknown = JSON.parse(raw);
      const validated = TicketPayloadSchema.safeParse(parsedJson);
      return validated.success ? validated.data : null;
    } catch {
      return null;
    }
  }
}
