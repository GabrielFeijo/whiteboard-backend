import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

interface ErrorWithStatus {
  status?: number;
  statusCode?: number;
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request | undefined>();
    const res = http.getResponse<Response | undefined>();

    return next.handle().pipe(
      tap({
        next: () => {
          if (req && res) {
            this.metrics.incrementHttpRequest(req.method || 'GET', res.statusCode || 200);
          }
        },
        error: (err: unknown) => {
          if (req) {
            const statusErr = err as ErrorWithStatus | null;
            const status = statusErr?.status ?? statusErr?.statusCode ?? 500;
            this.metrics.incrementHttpRequest(req.method || 'GET', status);
          }
        },
      }),
    );
  }
}
