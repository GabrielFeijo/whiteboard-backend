import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/core/config/env';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
};

describe('validateEnv', () => {
  it('aplica defaults e converte tipos', () => {
    const env = validateEnv(valid);
    expect(env.API_PORT).toBe(3001);
    expect(env.COLLAB_PORT).toBe(3002);
    expect(env.JWT_ACCESS_TTL).toBe(900);
    expect(env.ALLOWED_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('separa ALLOWED_ORIGINS por vírgula', () => {
    const env = validateEnv({ ...valid, ALLOWED_ORIGINS: 'http://a.com, http://b.com' });
    expect(env.ALLOWED_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });

  it('falha com segredo JWT curto e informa o campo', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'curto' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('falha sem DATABASE_URL', () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.DATABASE_URL;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });
});
