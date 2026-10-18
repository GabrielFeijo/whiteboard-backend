import { redisChannels as sharedRedisChannels } from '../../shared';

export const redisKeys = {
  authLockout: (email: string, ip = 'default') => `auth:lockout:${email.toLowerCase()}:${ip}`,
  authAttempts: (email: string, ip: string) => `auth:attempts:${email.toLowerCase()}:${ip}`,
  wsTicket: (ticket: string) => `ws:ticket:${ticket}`,
} as const;

export const redisChannels = {
  ...sharedRedisChannels,
  restore: (boardId: string) => `board:${boardId}:restore`,
} as const;
