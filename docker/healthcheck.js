const http = require('node:http');

const port = process.env.HEALTH_PORT || 3001;
const req = http.get({ host: '127.0.0.1', port, path: '/health/live', timeout: 2500 }, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});
req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
