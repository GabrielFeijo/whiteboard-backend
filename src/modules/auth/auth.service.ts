import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { Env } from '../../core/config/env';
import { UsersRepository, UserProfileRecord } from '../users/users.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { BruteForceService } from './services/brute-force.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface AuthTokensResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthSessionResult extends AuthTokensResult {
  user: {
    id: string;
    email: string;
    name: string;
    createdAt?: Date;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly bruteForceService: BruteForceService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<Env, true>,
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
  ): Promise<AuthTokensResult> {
    const payload = { id: user.id, email: user.email, name: user.name };
    const ttl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const refreshTtlDays = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) ?? 7;

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: ttl,
    });

    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

    await this.refreshTokenRepository.create({
      userId: user.id,
      familyId: familyId ?? nanoid(),
      tokenHash,
      expiresAt,
    });

    return { accessToken, refreshToken: rawRefreshToken, expiresIn: ttl };
  }

  async register(dto: RegisterDto): Promise<AuthSessionResult> {
    const normalizedEmail = dto.email.toLowerCase().trim();
    const existing = await this.usersRepository.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictException('Email address already registered');
    }

    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.usersRepository.create({
      email: normalizedEmail,
      name: dto.name,
      passwordHash,
    });

    const tokens = await this.generateTokens(user);
    return { user, ...tokens };
  }

  async login(dto: LoginDto, ip = 'unknown'): Promise<AuthSessionResult> {
    const email = dto.email.toLowerCase().trim();

    await this.bruteForceService.assertNotLocked(email);

    const user = await this.usersRepository.findByEmail(email);

    if (!user || user.deletedAt !== null) {
      await this.bruteForceService.recordFailedAttempt(email, ip);
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await this.verifyPassword(user.passwordHash, dto.password);
    if (!valid) {
      await this.bruteForceService.recordFailedAttempt(email, ip);
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.bruteForceService.clearAttempts(email, ip);

    const safeUser = { id: user.id, email: user.email, name: user.name };
    const tokens = await this.generateTokens(safeUser);
    return { user: safeUser, ...tokens };
  }

  async refresh(rawRefreshToken?: string): Promise<AuthSessionResult> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const storedToken = await this.refreshTokenRepository.findByHashWithUser(tokenHash);

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.revokedAt || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is expired or revoked');
    }

    if (storedToken.user.deletedAt !== undefined && storedToken.user.deletedAt !== null) {
      throw new UnauthorizedException('User account is deactivated');
    }

    if (storedToken.usedAt) {
      await this.refreshTokenRepository.revokeFamily(storedToken.familyId);
      throw new UnauthorizedException('Refresh token reuse detected. Token family revoked.');
    }

    await this.refreshTokenRepository.markAsUsed(storedToken.id);

    const user = {
      id: storedToken.user.id,
      email: storedToken.user.email,
      name: storedToken.user.name,
    };

    const tokens = await this.generateTokens(user, storedToken.familyId);
    return { user, ...tokens };
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) return;
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.refreshTokenRepository.revokeByHash(tokenHash);
  }

  async getMe(userId: string): Promise<UserProfileRecord> {
    const user = await this.usersRepository.findActiveProfileById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async deleteMe(userId: string): Promise<{ success: boolean; message: string }> {
    await this.usersRepository.anonymizeAndSoftDelete(userId);
    return { success: true, message: 'Account anonymized and deactivated' };
  }
}
