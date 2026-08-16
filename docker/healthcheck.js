/**
 * Container HEALTHCHECK probe.
 *
 * Written in Node rather than shelling out to curl so the runtime image does
 * not need an extra package installed purely to check itself. It calls the very
 * same /health endpoint clients use, which means a healthy container is one
 * that can actually reach PostgreSQL — not merely one whose process is alive.
 *
 * Exit 0 = healthy, exit 1 = unhealthy.
 */
const http = require('node:http');

const port = process.env.PORT || 3000;

const request = http.request(
  { host: '127.0.0.1', port, path: '/health', method: 'GET', timeout: 4000 },
  (response) => {
    // Drain the body so the socket closes cleanly instead of lingering.
    response.resume();
    response.on('end', () => process.exit(response.statusCode === 200 ? 0 : 1));
  },
);

request.on('error', () => process.exit(1));
request.on('timeout', () => {
  request.destroy();
  process.exit(1);
});

request.end();
