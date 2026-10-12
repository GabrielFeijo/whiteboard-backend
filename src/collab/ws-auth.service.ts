import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { Role } from '../shared';

export interface TicketPayload {
  userId: string;
  userName: string;
  boardId: string;
  role: Role;
}

@Injectable()
export class WsAuthService {
  constructor(private readonly redis: RedisService) {}

  async consumeTicket(ticket: string): Promise<TicketPayload | null> {
    if (!ticket) return null;
    // Atomic GETDEL guarantees single-use of ticket
    const raw = await this.redis.client.call('GETDEL', `ws:ticket:${ticket}`);
    if (!raw || typeof raw !== 'string') return null;

    try {
      return JSON.parse(raw) as TicketPayload;
    } catch {
      return null;
    }
  }
}
