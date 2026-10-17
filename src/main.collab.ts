import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { CollabModule } from './collab.module';
import { Env } from './core/config/env';

async function bootstrap(): Promise<void> {
  const logger = new Logger('BootstrapCollab');
  const app = await NestFactory.create(CollabModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  const port = config.get('COLLAB_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log(`Collab server listening on :${port}`);
}

void bootstrap();
