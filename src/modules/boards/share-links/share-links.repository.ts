import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { Role } from '../../../shared';

export interface ShareLinkRecord {
  id: string;
  boardId: string;
  tokenHash: string;
  role: Role;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface ShareLinkSummaryRecord {
  id: string;
  role: Role;
  createdAt: Date;
  expiresAt: Date | null;
}

@Injectable()
export class ShareLinksRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTokenHash(tokenHash: string): Promise<ShareLinkRecord | null> {
    return this.prisma.shareLink.findUnique({
      where: { tokenHash },
    });
  }

  async create(data: {
    boardId: string;
    tokenHash: string;
    role: Role;
    expiresAt: Date | null;
  }): Promise<ShareLinkRecord> {
    return this.prisma.shareLink.create({
      data,
    });
  }

  async findActiveByBoard(boardId: string): Promise<ShareLinkSummaryRecord[]> {
    return this.prisma.shareLink.findMany({
      where: {
        boardId,
        revokedAt: null,
      },
      select: {
        id: true,
        role: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(boardId: string, linkId: string): Promise<ShareLinkRecord> {
    return this.prisma.shareLink.update({
      where: { id: linkId, boardId },
      data: { revokedAt: new Date() },
    });
  }
}
