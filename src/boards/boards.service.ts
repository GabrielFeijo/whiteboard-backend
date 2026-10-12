import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Role } from '../shared';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { CreateLinkDto } from './dto/create-link.dto';
import { AddMemberDto } from './dto/add-member.dto';

@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async create(userId: string, dto: CreateBoardDto) {
    return this.prisma.$transaction(async (tx) => {
      const board = await tx.board.create({
        data: {
          title: dto.title,
          ownerId: userId,
        },
      });

      await tx.boardMember.create({
        data: {
          boardId: board.id,
          userId,
          role: 'OWNER',
        },
      });

      return board;
    });
  }

  async findAll(userId: string, cursor?: string, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 50);

    const boards = await this.prisma.board.findMany({
      where: {
        deletedAt: null,
        members: {
          some: { userId },
        },
      },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
        _count: {
          select: { members: true },
        },
      },
    });

    let nextCursor: string | null = null;
    if (boards.length > take) {
      const nextItem = boards.pop();
      nextCursor = nextItem?.id || null;
    }

    return {
      items: boards.map((b) => ({
        id: b.id,
        title: b.title,
        ownerId: b.ownerId,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        role: b.members[0]?.role || ('VIEWER' as Role),
        memberCount: b._count.members,
      })),
      nextCursor,
    };
  }

  async findOne(boardId: string, userId?: string, token?: string) {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, avatarUrl: true } },
          },
        },
      },
    });

    if (!board) {
      throw new NotFoundException('Board not found');
    }

    let userRole: Role | undefined;

    if (userId) {
      if (board.ownerId === userId) {
        userRole = 'OWNER';
      } else {
        const member = board.members.find((m) => m.userId === userId);
        if (member) {
          userRole = member.role;
        }
      }
    }

    if (token) {
      const tokenHash = this.hashToken(token);
      const link = await this.prisma.shareLink.findUnique({
        where: { tokenHash },
      });

      if (!link || link.boardId !== boardId || link.revokedAt !== null) {
        throw new ForbiddenException('Invalid or revoked share link');
      }

      if (link.expiresAt && link.expiresAt < new Date()) {
        throw new ForbiddenException('Share link has expired');
      }

      if (!userRole || (userRole === 'VIEWER' && link.role === 'EDITOR')) {
        userRole = link.role;
      }

      if (userId && board.ownerId !== userId) {
        await this.prisma.boardMember.upsert({
          where: {
            boardId_userId: { boardId, userId },
          },
          create: {
            boardId,
            userId,
            role: userRole,
          },
          update: {
            role: userRole,
          },
        });
      }
    } else if (!userRole) {
      if (userId) {
        throw new ForbiddenException('Access denied to board');
      } else {
        throw new UnauthorizedException('Authentication or share link required');
      }
    }

    return {
      ...board,
      role: userRole,
      currentUserRole: userRole,
    };
  }

  async update(boardId: string, userId: string, dto: UpdateBoardDto) {
    const board = await this.findOne(boardId, userId);
    if (board.currentUserRole === 'VIEWER') {
      throw new ForbiddenException('Viewers cannot rename board');
    }

    return this.prisma.board.update({
      where: { id: boardId },
      data: {
        title: dto.title ?? board.title,
      },
    });
  }

  async duplicate(boardId: string, userId: string) {
    const original = await this.findOne(boardId, userId);

    const latestSnapshot = await this.prisma.snapshot.findFirst({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
    });

    return this.prisma.$transaction(async (tx) => {
      const duplicated = await tx.board.create({
        data: {
          title: `Copy of ${original.title}`,
          ownerId: userId,
        },
      });

      await tx.boardMember.create({
        data: {
          boardId: duplicated.id,
          userId,
          role: 'OWNER',
        },
      });

      if (latestSnapshot) {
        await tx.snapshot.create({
          data: {
            boardId: duplicated.id,
            data: latestSnapshot.data,
            version: 1,
            reason: 'MANUAL',
          },
        });
      }

      return duplicated;
    });
  }

  async remove(boardId: string, userId: string) {
    const board = await this.findOne(boardId, userId);
    if (board.ownerId !== userId && board.currentUserRole !== 'OWNER') {
      throw new ForbiddenException('Only the board owner can delete it');
    }

    return this.prisma.board.update({
      where: { id: boardId },
      data: { deletedAt: new Date() },
    });
  }

  async createShareLink(boardId: string, userId: string, dto: CreateLinkDto) {
    const board = await this.findOne(boardId, userId);
    if (board.currentUserRole === 'VIEWER') {
      throw new ForbiddenException('Only editors or owners can create share links');
    }

    const rawToken = crypto.randomBytes(24).toString('base64url');
    const tokenHash = this.hashToken(rawToken);

    const expiresAt = dto.expiresInHours
      ? new Date(Date.now() + dto.expiresInHours * 60 * 60 * 1000)
      : null;

    const link = await this.prisma.shareLink.create({
      data: {
        boardId,
        tokenHash,
        role: dto.role || 'VIEWER',
        expiresAt,
      },
    });

    return {
      id: link.id,
      boardId: link.boardId,
      token: rawToken,
      role: link.role,
      expiresAt: link.expiresAt,
    };
  }

  async listShareLinks(boardId: string, userId: string) {
    await this.findOne(boardId, userId);

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

  async revokeShareLink(boardId: string, linkId: string, userId: string) {
    const board = await this.findOne(boardId, userId);
    if (board.ownerId !== userId && board.currentUserRole !== 'OWNER') {
      throw new ForbiddenException('Only owner can revoke links');
    }

    const updated = await this.prisma.shareLink.update({
      where: { id: linkId, boardId },
      data: { revokedAt: new Date() },
    });

    await this.redis.client.publish(
      `board:${boardId}:acl`,
      JSON.stringify({ type: 'REVOKE_LINK', linkId }),
    );

    return updated;
  }

  async issueWsTicket(boardId: string, user?: { id: string; name: string }, linkToken?: string) {
    let resolvedRole: Role = 'VIEWER';
    let resolvedUserId = user ? user.id : '';
    let resolvedName = user ? user.name : 'Anonymous Guest';

    if (user) {
      const board = await this.prisma.board.findFirst({
        where: { id: boardId, deletedAt: null },
        include: {
          members: { where: { userId: user.id } },
        },
      });

      if (board) {
        if (board.ownerId === user.id) {
          resolvedRole = 'OWNER';
        } else if (board.members.length > 0) {
          resolvedRole = board.members[0].role;
        } else if (!linkToken) {
          throw new ForbiddenException('Access denied to board');
        }
      } else {
        throw new NotFoundException('Board not found');
      }
    }

    if (linkToken) {
      const tokenHash = this.hashToken(linkToken);
      const link = await this.prisma.shareLink.findUnique({
        where: { tokenHash },
      });

      if (!link || link.boardId !== boardId || link.revokedAt !== null) {
        throw new ForbiddenException('Invalid or revoked share link');
      }

      if (link.expiresAt && link.expiresAt < new Date()) {
        throw new ForbiddenException('Share link has expired');
      }

      if (!user || resolvedRole === 'VIEWER' || link.role === 'EDITOR') {
        if (resolvedRole !== 'OWNER') {
          resolvedRole = link.role;
        }
      }

      if (!user) {
        resolvedUserId = `guest_${nanoid(8)}`;
        resolvedName = `Guest ${resolvedUserId.slice(-4)}`;
      } else if (resolvedRole !== 'OWNER') {
        await this.prisma.boardMember.upsert({
          where: {
            boardId_userId: { boardId, userId: user.id },
          },
          create: {
            boardId,
            userId: user.id,
            role: resolvedRole,
          },
          update: {
            role: resolvedRole,
          },
        });
      }
    }

    if (!resolvedUserId) {
      throw new BadRequestException('Authentication or share link required');
    }

    const ticket = `wst_${nanoid(32)}`;
    const ticketPayload = JSON.stringify({
      userId: resolvedUserId,
      userName: resolvedName,
      boardId,
      role: resolvedRole,
    });

    await this.redis.client.set(`ws:ticket:${ticket}`, ticketPayload, 'EX', 30);

    return {
      ticket,
      role: resolvedRole,
      boardId,
      userId: resolvedUserId,
      userName: resolvedName,
    };
  }

  async listSnapshots(boardId: string, userId: string) {
    await this.findOne(boardId, userId);

    const snapshots = await this.prisma.snapshot.findMany({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        boardId: true,
        version: true,
        reason: true,
        createdAt: true,
        data: true,
      },
    });

    return snapshots.map((s) => ({
      id: s.id,
      boardId: s.boardId,
      version: s.version,
      reason: s.reason,
      createdAt: s.createdAt,
      size: s.data.length,
    }));
  }

  async restoreSnapshot(boardId: string, snapshotId: string, userId: string) {
    const board = await this.findOne(boardId, userId);
    if (board.currentUserRole !== 'OWNER' && board.currentUserRole !== 'EDITOR') {
      throw new ForbiddenException('Only owners and editors can restore snapshots');
    }

    const targetSnapshot = await this.prisma.snapshot.findFirst({
      where: { id: snapshotId, boardId },
    });

    if (!targetSnapshot) {
      throw new NotFoundException('Snapshot not found');
    }

    const latestSnapshot = await this.prisma.snapshot.findFirst({
      where: { boardId },
      orderBy: { version: 'desc' },
    });

    const newVersion = (latestSnapshot?.version || targetSnapshot.version) + 1;

    const restoredRecord = await this.prisma.snapshot.create({
      data: {
        boardId,
        data: targetSnapshot.data,
        version: newVersion,
        reason: `RESTORED_FROM_V${targetSnapshot.version}`,
      },
    });

    await this.redis.client.publish(
      `board:${boardId}:restore`,
      JSON.stringify({
        snapshotId: targetSnapshot.id,
        version: newVersion,
        data: Buffer.from(targetSnapshot.data).toString('base64'),
      }),
    );

    return {
      success: true,
      id: restoredRecord.id,
      version: restoredRecord.version,
      restoredFromVersion: targetSnapshot.version,
      createdAt: restoredRecord.createdAt,
    };
  }

  async addMember(boardId: string, userId: string, dto: AddMemberDto) {
    const board = await this.findOne(boardId, userId);
    if (board.ownerId !== userId && board.currentUserRole !== 'OWNER') {
      throw new ForbiddenException('Only owner can add members directly');
    }

    const email = dto.email.toLowerCase().trim();
    const targetUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found with this email');
    }

    if (targetUser.id === board.ownerId) {
      throw new BadRequestException('User is already the board owner');
    }

    return this.prisma.boardMember.upsert({
      where: {
        boardId_userId: { boardId, userId: targetUser.id },
      },
      create: {
        boardId,
        userId: targetUser.id,
        role: dto.role,
      },
      update: {
        role: dto.role,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });
  }

  async listMembers(boardId: string, userId: string) {
    await this.findOne(boardId, userId);
    return this.prisma.boardMember.findMany({
      where: { boardId },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { role: 'asc' },
    });
  }

  async removeMember(boardId: string, memberUserId: string, userId: string) {
    const board = await this.findOne(boardId, userId);
    if (board.ownerId !== userId && board.currentUserRole !== 'OWNER') {
      throw new ForbiddenException('Only owner can remove members');
    }
    if (memberUserId === board.ownerId) {
      throw new BadRequestException('Cannot remove board owner');
    }
    return this.prisma.boardMember.delete({
      where: {
        boardId_userId: { boardId, userId: memberUserId },
      },
    });
  }
}
