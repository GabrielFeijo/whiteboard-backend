import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    return next.handle().pipe(
      tap({
        next: () => {
          if (req && res) {
            this.metrics.incrementHttpRequest(req.method || 'GET', res.statusCode || 200);
          }
        },
        error: (err) => {
          if (req) {
            const status = err.status || err.statusCode || 500;
            this.metrics.incrementHttpRequest(req.method || 'GET', status);
          }
        },
      }),
    );
  }
}
