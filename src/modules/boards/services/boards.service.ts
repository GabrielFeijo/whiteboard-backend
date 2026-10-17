import { Injectable } from '@nestjs/common';
import { Role } from '../../../shared';
import { CreateBoardDto } from '../dto/create-board.dto';
import { UpdateBoardDto } from '../dto/update-board.dto';
import { BoardRecord, BoardsRepository } from '../repositories/boards.repository';
import { SnapshotsRepository } from '../snapshots/snapshots.repository';
import { BoardAclService, ResolvedBoardWithRole } from './board-acl.service';

export interface PaginatedBoardsResult {
  items: Array<{
    id: string;
    title: string;
    ownerId: string;
    createdAt?: Date;
    updatedAt?: Date;
    role: Role;
    memberCount: number;
  }>;
  nextCursor: string | null;
}

@Injectable()
export class BoardsService {
  constructor(
    private readonly boardsRepository: BoardsRepository,
    private readonly snapshotsRepository: SnapshotsRepository,
    private readonly boardAclService: BoardAclService,
  ) {}

  async create(userId: string, dto: CreateBoardDto): Promise<BoardRecord> {
    return this.boardsRepository.createWithOwner(userId, dto.title);
  }

  async findAll(userId: string, cursor?: string, limit = 20): Promise<PaginatedBoardsResult> {
    const take = Math.min(Math.max(limit, 1), 50);
    const boards = await this.boardsRepository.findManyPaginated(userId, take, cursor);

    let nextCursor: string | null = null;
    if (boards.length > take) {
      const nextItem = boards.pop();
      nextCursor = nextItem?.id ?? null;
    }

    return {
      items: boards.map((b) => ({
        id: b.id,
        title: b.title,
        ownerId: b.ownerId,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        role: b.members[0]?.role ?? Role.VIEWER,
        memberCount: b._count.members,
      })),
      nextCursor,
    };
  }

  async findOne(boardId: string, userId?: string, token?: string): Promise<ResolvedBoardWithRole> {
    return this.boardAclService.resolveBoardWithAccess(boardId, userId, token);
  }

  async update(boardId: string, userId: string, dto: UpdateBoardDto): Promise<BoardRecord> {
    const board = await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    this.boardAclService.assertCanEdit(board, 'Viewers cannot rename board');

    return this.boardsRepository.updateTitle(boardId, dto.title ?? board.title);
  }

  async duplicate(boardId: string, userId: string): Promise<BoardRecord> {
    const original = await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    const latestSnapshot = await this.snapshotsRepository.findLatestByBoard(boardId);

    return this.boardsRepository.duplicateWithSnapshot(
      original.title,
      userId,
      latestSnapshot?.data,
    );
  }

  async remove(boardId: string, userId: string): Promise<BoardRecord> {
    const board = await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    this.boardAclService.assertOwner(board, userId, 'Only the board owner can delete it');

    return this.boardsRepository.softDelete(boardId);
  }
}
