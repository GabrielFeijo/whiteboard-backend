import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from '../../src/core/redis/redis.service';
import { WsAuthService } from '../../src/modules/collab/ws-auth.service';

describe('WsAuthService', () => {
  let service: WsAuthService;
  let mockRedis: {
    client: {
      call: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockRedis = {
      client: {
        call: vi.fn(),
      },
    };
    service = new WsAuthService(mockRedis as unknown as RedisService);
  });

  it('consumes a valid ticket using GETDEL atomic operation', async () => {
    const validTicket = 'wst_1234567890abcdef1234567890abcdef';
    const payload = {
      userId: 'user-1',
      userName: 'Alice',
      boardId: 'board-abc',
      role: 'OWNER',
    };

    mockRedis.client.call.mockResolvedValue(JSON.stringify(payload));

    const result = await service.consumeTicket(validTicket);

    expect(mockRedis.client.call).toHaveBeenCalledWith('GETDEL', `ws:ticket:${validTicket}`);
    expect(result).toEqual(payload);
  });

  it('returns null if ticket is empty or whitespace', async () => {
    expect(await service.consumeTicket('')).toBeNull();
    expect(mockRedis.client.call).not.toHaveBeenCalled();
  });

  it('returns null if ticket does not exist or has already been consumed in Redis', async () => {
    mockRedis.client.call.mockResolvedValue(null);

    const result = await service.consumeTicket('wst_expired_ticket');

    expect(result).toBeNull();
  });

  it('returns null if ticket payload is invalid JSON or fails schema validation', async () => {
    mockRedis.client.call.mockResolvedValueOnce('invalid json {');
    expect(await service.consumeTicket('wst_bad_json')).toBeNull();

    mockRedis.client.call.mockResolvedValueOnce(
      JSON.stringify({ userId: 'u1', role: 'INVALID_ROLE' }),
    );
    expect(await service.consumeTicket('wst_bad_schema')).toBeNull();
  });
});
