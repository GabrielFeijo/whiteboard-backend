import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private httpRequestsTotal = new Map<string, number>();
  private activeRooms = 0;
  private activeConnections = 0;
  private syncMessagesTotal = 0;

  incrementHttpRequest(method: string, status: number) {
    const key = `method="${method}",status="${status}"`;
    const current = this.httpRequestsTotal.get(key) || 0;
    this.httpRequestsTotal.set(key, current + 1);
  }

  setActiveRooms(count: number) {
    this.activeRooms = Math.max(0, count);
  }

  setActiveConnections(count: number) {
    this.activeConnections = Math.max(0, count);
  }

  incrementSyncMessages() {
    this.syncMessagesTotal += 1;
  }

  renderMetrics(): string {
    const lines: string[] = [
      '# HELP whiteboard_http_requests_total Total number of HTTP requests processed',
      '# TYPE whiteboard_http_requests_total counter',
    ];

    if (this.httpRequestsTotal.size === 0) {
      lines.push('whiteboard_http_requests_total{method="GET",status="200"} 0');
    } else {
      this.httpRequestsTotal.forEach((count, labels) => {
        lines.push(`whiteboard_http_requests_total{${labels}} ${count}`);
      });
    }

    lines.push(
      '',
      '# HELP whiteboard_active_rooms Number of currently active Yjs rooms in memory',
      '# TYPE whiteboard_active_rooms gauge',
      `whiteboard_active_rooms ${this.activeRooms}`,
      '',
      '# HELP whiteboard_active_connections Number of active WebSocket client connections',
      '# TYPE whiteboard_active_connections gauge',
      `whiteboard_active_connections ${this.activeConnections}`,
      '',
      '# HELP whiteboard_sync_messages_total Total number of Yjs sync updates processed',
      '# TYPE whiteboard_sync_messages_total counter',
      `whiteboard_sync_messages_total ${this.syncMessagesTotal}`,
      '',
    );

    return lines.join('\n');
  }
}
