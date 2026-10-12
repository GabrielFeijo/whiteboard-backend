import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { Env, validateEnv } from './env';

export type AppConfigService = ConfigService<Env, true>;

@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true })],
  exports: [NestConfigModule],
})
export class AppConfigModule {}
