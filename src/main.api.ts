import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('v1', { exclude: ['health/(.*)', 'health'] });

  app.enableShutdownHooks();
  app.enableCors({
    origin: config.get('ALLOWED_ORIGINS', { infer: true }),
    credentials: true,
  });

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Whiteboard API')
      .setDescription('REST API for Real-Time Collaborative Whiteboard')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('v1/docs', app, doc, { jsonDocumentUrl: 'v1/docs-json' });

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on :${port}`);
}

bootstrap();
