import { redisChannels as sharedRedisChannels } from '../../shared';

export const redisKeys = {
  authLockout: (email: string, ip = 'default') => `auth:lockout:${email.toLowerCase()}:${ip}`,
  authAttempts: (email: string, ip: string) => `auth:attempts:${email.toLowerCase()}:${ip}`,
  authUserRevoked: (userId: string) => `auth:revoked:${userId}`,
  wsTicket: (ticket: string) => `ws:ticket:${ticket}`,
} as const;

export const redisChannels = sharedRedisChannels;
