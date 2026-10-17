import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../shared';
import { ROLES_KEY } from '../decorators/board-roles.decorator';
import {
  AuthenticatedRequest,
  BoardAccessContext,
} from '../types/express-request.interface';

export const BOARD_ACL_RESOLVER = Symbol('BOARD_ACL_RESOLVER');

export interface BoardAclResolver {
  resolveBoardAccess(
    boardId: string,
    userId?: string,
    shareToken?: string,
  ): Promise<BoardAccessContext>;
}

@Injectable()
export class BoardAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(BOARD_ACL_RESOLVER) private readonly aclResolver: BoardAclResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawBoardId = request.params.boardId ?? request.params.id;
    const boardId = Array.isArray(rawBoardId) ? rawBoardId[0] : rawBoardId;

    if (!boardId) {
      throw new BadRequestException('Board identifier is required');
    }

    const rawQueryToken = request.query?.token;
    const bodyObj =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as Record<string, unknown>)
        : undefined;
    const rawBodyToken = typeof bodyObj?.token === 'string' ? bodyObj.token : undefined;
    const shareToken =
      typeof rawQueryToken === 'string' ? rawQueryToken : rawBodyToken;

    const access = await this.aclResolver.resolveBoardAccess(
      boardId,
      request.user?.id,
      shareToken,
    );

    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(access.role)) {
      throw new ForbiddenException(
        `Insufficient permissions: requires one of [${requiredRoles.join(', ')}]`,
      );
    }

    request.boardAccess = access;
    return true;
  }
}
