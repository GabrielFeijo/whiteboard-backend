import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { AuthenticatedRequest } from '../types/express-request.interface';

interface HttpExceptionResponseObj {
  message?: string | string[];
  error?: string;
}

export interface ProblemDetailsResponse {
  type: string;
  title: string;
  status: number;
  statusCode: number;
  detail: string;
  message: string | string[];
  error: string;
  instance: string;
  requestId?: string;
  timestamp: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      return;
    }

    const ctx = host.switchToHttp();
    const req = ctx.getRequest<AuthenticatedRequest>();
    const res = ctx.getResponse<Response>();

    const resolved = this.resolveException(exception);

    if (resolved.status >= 500) {
      this.logger.error(
        `[${req.method}] ${req.url} -> ${resolved.status} (requestId=${req.requestId ?? 'none'})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ProblemDetailsResponse = {
      type: `https://httpstatuses.com/${resolved.status}`,
      title: resolved.error,
      status: resolved.status,
      statusCode: resolved.status,
      detail: Array.isArray(resolved.message) ? resolved.message.join(', ') : resolved.message,
      message: resolved.message,
      error: resolved.error,
      instance: req.originalUrl || req.url,
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    };

    res.status(resolved.status).json(body);
  }

  private resolveException(exception: unknown): {
    status: number;
    message: string | string[];
    error: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const rawResponse = exception.getResponse();

      if (typeof rawResponse === 'string') {
        return {
          status,
          message: rawResponse,
          error: exception.name,
        };
      }

      if (typeof rawResponse === 'object' && rawResponse !== null) {
        const obj = rawResponse as HttpExceptionResponseObj;
        return {
          status,
          message: obj.message ?? exception.message,
          error: obj.error ?? exception.name,
        };
      }

      return {
        status,
        message: exception.message,
        error: exception.name,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Requested record was not found',
          error: 'Not Found',
        };
      }
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          message: 'Resource already exists with conflicting unique constraint',
          error: 'Conflict',
        };
      }
      if (exception.code === 'P2003') {
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Invalid relation reference',
          error: 'Bad Request',
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }
}
