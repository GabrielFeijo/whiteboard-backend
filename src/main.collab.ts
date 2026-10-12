import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { CollabModule } from './collab.module';
import { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(CollabModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  const port = config.get('COLLAB_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  console.log(`Collab server listening on :${port}`);
}

bootstrap();
