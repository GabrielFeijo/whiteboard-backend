import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  /** Cliente de uso geral (comandos). */
  readonly client: Redis;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
  }

  /** Conexão dedicada para subscribe (uma conexão em modo subscriber não executa comandos). */
  duplicate(): Redis {
    return this.client.duplicate();
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
