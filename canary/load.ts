import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/**
 * Steady concurrent load on the public URL, the same for both tracks, so they are
 * compared under equal conditions. Counts who answered each request: that is the split.
 *
 *   npx ts-node canary/load.ts --url http://... [--seconds 60] [--rps 20] [--fault error|latency] [--canary]
 */

interface Outcome {
  served: string;
  status: number;
  ms: number;
}

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    seconds: { type: 'string', default: '60' },
    rps: { type: 'string', default: '20' },
    fault: { type: 'string', default: 'none' },
    canary: { type: 'boolean', default: false },
  },
});

const MAX_IN_FLIGHT = 100;

// A realistic mix: mostly reads, and a write per five requests that keeps stock unchanged.
let sent = 0;
function nextRequest(): [string, RequestInit] {
  const n = sent++;
  if (n % 5 === 4) {
    const type = n % 10 === 4 ? 'IN' : 'OUT';
    return [
      '/api/movements',
      { method: 'POST', body: JSON.stringify({ itemId: 4, type, quantity: 1 }) },
    ];
  }
  if (n % 5 === 3) return ['/api/groups', {}];
  if (n % 5 === 2) return ['/api/items?limit=5', {}];
  return [`/api/items/${(n % 6) + 1}`, {}];
}

async function call(baseUrl: string, headers: Record<string, string>): Promise<Outcome> {
  const [path, init] = nextRequest();
  const started = performance.now();
  try {
    const res = await fetch(baseUrl + path, {
      ...init,
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    await res.arrayBuffer();
    const served = `${res.headers.get('x-app-track')} ${res.headers.get('x-app-version')}`;
    return { served, status: res.status, ms: performance.now() - started };
  } catch {
    return { served: 'no answer', status: 0, ms: performance.now() - started };
  }
}

function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
}

function report(outcomes: Outcome[]): string {
  const rows = [
    '| served by | requests | share | 2xx | 4xx | 5xx | p50 ms | p95 ms |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const served of [...new Set(outcomes.map((o) => o.served))].sort()) {
    const mine = outcomes.filter((o) => o.served === served);
    const ms = mine.map((o) => o.ms).sort((a, b) => a - b);
    const count = (from: number) => mine.filter((o) => o.status >= from && o.status < from + 100);
    rows.push(
      `| ${served} | ${mine.length} | ${((100 * mine.length) / outcomes.length).toFixed(1)}% ` +
        `| ${count(200).length} | ${count(400).length} | ${count(500).length} ` +
        `| ${percentile(ms, 0.5).toFixed(0)} | ${percentile(ms, 0.95).toFixed(0)} |`,
    );
  }
  return rows.join('\n');
}

async function main(): Promise<void> {
  if (!values.url) throw new Error('--url is required');
  const rps = Number(values.rps);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (values.fault !== 'none') headers['x-fault'] = values.fault;
  if (values.canary) headers['x-canary'] = 'true';

  const outcomes: Outcome[] = [];
  let inFlight = 0;
  const pending: Promise<void>[] = [];

  // Open loop: requests leave on schedule whether or not earlier ones came back,
  // so a slow track gets the same traffic, as it would from real clients.
  const timer = setInterval(() => {
    if (inFlight >= MAX_IN_FLIGHT) return;
    inFlight++;
    pending.push(
      call(values.url!, headers).then((o) => {
        outcomes.push(o);
        inFlight--;
      }),
    );
  }, 1000 / rps);

  await new Promise((resolve) => setTimeout(resolve, Number(values.seconds) * 1000));
  clearInterval(timer);
  await Promise.all(pending);

  const table = report(outcomes);
  console.log(
    `${outcomes.length} requests in ${values.seconds} s, fault: ${values.fault}\n${table}`,
  );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n\n`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
