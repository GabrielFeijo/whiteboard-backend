import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Env } from '../config/env';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly redis: RedisService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  private async generateTokens(
    user: { id: string; email: string; name: string },
    familyId?: string,
  ) {
    const payload = { id: user.id, email: user.email, name: user.name };
    const ttl = this.config.get('JWT_ACCESS_TTL', { infer: true });

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: ttl,
    });

    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId: familyId || nanoid(),
        tokenHash,
        expiresAt,
      },
    });

    return { accessToken, refreshToken: rawRefreshToken, expiresIn: ttl };
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Email address already registered');
    }

    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash,
      },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    const tokens = await this.generateTokens(user);
    return { user, ...tokens };
  }

  async login(dto: LoginDto, ip = 'unknown') {
    const email = dto.email.toLowerCase();
    const lockoutKey = `auth:lockout:${email}`;
    const attemptsKey = `auth:attempts:${email}:${ip}`;

    const isLocked = await this.redis.client.get(lockoutKey);
    if (isLocked) {
      throw new ForbiddenException(
        'Account temporarily locked due to failed attempts. Try again in 15 minutes.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.deletedAt !== null) {
      await this.handleFailedAttempt(attemptsKey, lockoutKey);
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await this.verifyPassword(user.passwordHash, dto.password);
    if (!valid) {
      await this.handleFailedAttempt(attemptsKey, lockoutKey);
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.redis.client.del(attemptsKey);

    const safeUser = { id: user.id, email: user.email, name: user.name };
    const tokens = await this.generateTokens(safeUser);
    return { user: safeUser, ...tokens };
  }

  private async handleFailedAttempt(attemptsKey: string, lockoutKey: string) {
    const attempts = await this.redis.client.incr(attemptsKey);
    if (attempts === 1) {
      await this.redis.client.expire(attemptsKey, 900);
    }
    if (attempts >= 5) {
      await this.redis.client.set(lockoutKey, '1', 'EX', 900);
    }
  }

  async refresh(rawRefreshToken: string) {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.revokedAt || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is expired or revoked');
    }

    if (storedToken.usedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: storedToken.familyId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected. Token family revoked.');
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { usedAt: new Date() },
    });

    const user = {
      id: storedToken.user.id,
      email: storedToken.user.email,
      name: storedToken.user.name,
    };

    const tokens = await this.generateTokens(user, storedToken.familyId);
    return { user, ...tokens };
  }

  async logout(rawRefreshToken?: string) {
    if (!rawRefreshToken) return;
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, avatarUrl: true, createdAt: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async deleteMe(userId: string) {
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          name: 'Deleted User',
          email: `deleted_${userId}@whiteboard.local`,
          deletedAt: new Date(),
        },
      }),
    ]);
    return { success: true, message: 'Account anonymized and deactivated' };
  }
}
