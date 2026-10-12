import { describe, expect, it } from 'vitest';
import { MetricsService } from '../../src/metrics/metrics.service';

describe('MetricsService', () => {
  it('renders prometheus text metrics with initial zero counters', () => {
    const service = new MetricsService();
    const rendered = service.renderMetrics();

    expect(rendered).toContain('whiteboard_http_requests_total');
    expect(rendered).toContain('whiteboard_active_rooms 0');
    expect(rendered).toContain('whiteboard_active_connections 0');
    expect(rendered).toContain('whiteboard_sync_messages_total 0');
  });

  it('increments requests and updates gauges correctly', () => {
    const service = new MetricsService();
    service.incrementHttpRequest('POST', 201);
    service.incrementHttpRequest('POST', 201);
    service.incrementHttpRequest('GET', 200);
    service.setActiveRooms(3);
    service.setActiveConnections(8);
    service.incrementSyncMessages();

    const rendered = service.renderMetrics();
    expect(rendered).toContain('whiteboard_http_requests_total{method="POST",status="201"} 2');
    expect(rendered).toContain('whiteboard_http_requests_total{method="GET",status="200"} 1');
    expect(rendered).toContain('whiteboard_active_rooms 3');
    expect(rendered).toContain('whiteboard_active_connections 8');
    expect(rendered).toContain('whiteboard_sync_messages_total 1');
  });
});
