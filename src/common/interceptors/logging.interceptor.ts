import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthenticatedRequest } from '../types/express-request.interface';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          const sanitizedPath = (req.originalUrl || req.url).split('?')[0];
          this.logger.log(
            `${req.method} ${sanitizedPath} ${res.statusCode} - ${duration}ms [reqId=${req.requestId ?? 'n/a'}]`,
          );
        },
      }),
    );
  }
}
