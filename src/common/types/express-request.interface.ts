import { Request } from 'express';
import { z } from 'zod';
import { Role } from '../../shared';

export const AuthenticatedUserSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  name: z.string().min(1),
});

export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;

export interface BoardAccessContext {
  boardId: string;
  title: string;
  ownerId: string;
  role: Role;
  isAnonymous: boolean;
  linkId?: string;
}

export interface AuthenticatedRequest extends Request {
  requestId?: string;
  user?: AuthenticatedUser;
  boardAccess?: BoardAccessContext;
}
