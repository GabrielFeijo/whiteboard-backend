import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  AuthenticatedRequest,
  BoardAccessContext,
} from '../types/express-request.interface';

export const CurrentBoardAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BoardAccessContext | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.boardAccess;
  },
);
