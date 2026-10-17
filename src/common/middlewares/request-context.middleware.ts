import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import * as crypto from 'node:crypto';
import { AuthenticatedRequest } from '../types/express-request.interface';

const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const incomingHeader = req.headers['x-request-id'];
    const rawId = Array.isArray(incomingHeader) ? incomingHeader[0] : incomingHeader;
    const requestId = rawId && SAFE_REQUEST_ID_REGEX.test(rawId) ? rawId : crypto.randomUUID();

    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
