import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Env } from '../../core/config/env';
import {
  AuthenticatedRequest,
  AuthenticatedUser,
  AuthenticatedUserSchema,
} from '../types/express-request.interface';

export function extractBearerToken(request: AuthenticatedRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function verifyBearerToken(
  token: string,
  jwtService: JwtService,
  config: ConfigService<Env, true>,
): Promise<AuthenticatedUser> {
  try {
    const rawPayload: unknown = await jwtService.verifyAsync(token, {
      secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
    const parsed = AuthenticatedUserSchema.safeParse(rawPayload);
    if (!parsed.success) {
      throw new UnauthorizedException('Malformed token payload');
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof UnauthorizedException) {
      throw err;
    }
    throw new UnauthorizedException('Token is expired or invalid');
  }
}
