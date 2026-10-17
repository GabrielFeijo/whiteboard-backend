import { z } from 'zod';

const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3001),
  COLLAB_PORT: z.coerce.number().int().default(3002),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET deve ter ao menos 32 caracteres'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_COOKIE_NAME: z.string().default('wb_refresh'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  AUTH_LOCKOUT_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_MAX_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  WS_TICKET_TTL: z.coerce.number().int().positive().default(30),
  ALLOWED_ORIGINS: csv('http://localhost:3000'),

  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração de ambiente inválida — ${issues}`);
  }
  return parsed.data;
}
