import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';

export interface UserProfileRecord {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  createdAt: Date;
}

export interface UserWithCredentialsRecord {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  passwordHash: string;
  deletedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<UserWithCredentialsRecord | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
  }

  async findActiveProfileById(userId: string): Promise<UserProfileRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt !== null) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    };
  }

  async create(data: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<UserProfileRecord> {
    return this.prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        name: data.name.trim(),
        passwordHash: data.passwordHash,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });
  }

  async anonymizeAndSoftDelete(userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId },
        data: { revokedAt: now },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          name: 'Deleted User',
          email: `deleted_${userId}@whiteboard.local`,
          deletedAt: now,
        },
      }),
    ]);
  }
}
