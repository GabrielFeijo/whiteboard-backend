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
      return this.resolveHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrismaException(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }

  private resolveHttpException(exception: HttpException): {
    status: number;
    message: string | string[];
    error: string;
  } {
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

  private resolvePrismaException(exception: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string | string[];
    error: string;
  } {
    const mapped = PRISMA_ERROR_MAPPINGS[exception.code];
    if (mapped) {
      return mapped;
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }
}

export const PrismaErrorCode = {
  NOT_FOUND: 'P2025',
  UNIQUE_CONSTRAINT_FAILED: 'P2002',
  FOREIGN_KEY_FAILED: 'P2003',
} as const;
export type PrismaErrorCode = (typeof PrismaErrorCode)[keyof typeof PrismaErrorCode];

const PRISMA_ERROR_MAPPINGS: Record<string, { status: number; message: string; error: string }> = {
  [PrismaErrorCode.NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: 'Requested record was not found',
    error: 'Not Found',
  },
  [PrismaErrorCode.UNIQUE_CONSTRAINT_FAILED]: {
    status: HttpStatus.CONFLICT,
    message: 'This resource already exists',
    error: 'Conflict',
  },
  [PrismaErrorCode.FOREIGN_KEY_FAILED]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Invalid relation reference',
    error: 'Bad Request',
  },
};
