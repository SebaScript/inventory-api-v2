import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  GetMetricDataCommand,
  MetricDataQuery,
} from '@aws-sdk/client-cloudwatch';
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import slo from './slo.json';

/**
 * Judges one stage from what CloudWatch measured on each track while it baked:
 * promote, pause (hold the weight, a person decides) or abort (all traffic to stable).
 *
 *   npx ts-node canary/gate.ts --start <ISO> --end <ISO> --gate "$(terraform output -json canary_gate)"
 *
 * Exit code: 0 promote, 3 pause, 4 abort. Anything else is a broken gate, also treated as abort.
 */

export type Slo = typeof slo;
export type Decision = 'promote' | 'pause' | 'abort';

export interface TrackStats {
  requests: number;
  errors: number;
  rejected: number;
  p95Ms: number;
}

interface Threshold {
  pause: number;
  abort: number;
}

const rate = (count: number, t: TrackStats) => (t.requests ? count / t.requests : 0);

export function decide(
  canary: TrackStats,
  stable: TrackStats,
  rules: Slo = slo,
): { decision: Decision; reasons: string[] } {
  if (canary.requests < rules.minRequestsPerTrack) {
    return {
      decision: 'pause',
      reasons: [`only ${canary.requests} canary requests, ${rules.minRequestsPerTrack} needed`],
    };
  }

  const checks: [string, number, Threshold][] = [
    ['5xx rate', rate(canary.errors, canary), rules.objectives.errorRate],
    ['4xx rate', rate(canary.rejected, canary), rules.objectives.clientErrorRate],
    ['p95 ms', canary.p95Ms, rules.objectives.p95LatencyMs],
  ];
  // Against the baseline only when it ran alongside with enough traffic: never at 100%.
  if (stable.requests >= rules.minRequestsPerTrack) {
    checks.push(
      [
        '5xx rate over stable',
        rate(canary.errors, canary) - rate(stable.errors, stable),
        rules.versusStable.errorRateExcess,
      ],
      ['p95 ms over stable', canary.p95Ms - stable.p95Ms, rules.versusStable.p95LatencyExcessMs],
    );
  }

  const over = (level: keyof Threshold) =>
    checks
      .filter(([, value, threshold]) => value > threshold[level])
      .map(([name, value, threshold]) => `${name} ${+value.toFixed(3)} > ${threshold[level]}`);

  const aborts = over('abort');
  if (aborts.length) return { decision: 'abort', reasons: aborts };
  const pauses = over('pause');
  if (pauses.length) return { decision: 'pause', reasons: pauses };
  return { decision: 'promote', reasons: ['every objective met'] };
}

interface GateTargets {
  load_balancer: string;
  target_groups: Record<'stable' | 'canary', { suffix: string }>;
  alarms: string[];
}

async function measure(gate: GateTargets, start: Date, end: Date) {
  // One datapoint covering the whole bake, which CloudWatch requires in whole minutes.
  const from = new Date(Math.floor(start.getTime() / 60_000) * 60_000);
  const period = Math.max(60, Math.ceil((end.getTime() - from.getTime()) / 60_000) * 60);
  const tracks = ['stable', 'canary'] as const;
  const metrics = [
    ['requests', 'RequestCount', 'Sum'],
    ['errors', 'HTTPCode_Target_5XX_Count', 'Sum'],
    ['rejected', 'HTTPCode_Target_4XX_Count', 'Sum'],
    ['latency', 'TargetResponseTime', 'p95'],
  ] as const;

  const queries: MetricDataQuery[] = tracks.flatMap((track) =>
    metrics.map(([id, name, stat]) => ({
      Id: `${id}_${track}`,
      MetricStat: {
        Metric: {
          Namespace: 'AWS/ApplicationELB',
          MetricName: name,
          Dimensions: [
            { Name: 'TargetGroup', Value: gate.target_groups[track].suffix },
            { Name: 'LoadBalancer', Value: gate.load_balancer },
          ],
        },
        Period: period,
        Stat: stat,
      },
    })),
  );

  const client = new CloudWatchClient({});
  const { MetricDataResults = [] } = await client.send(
    new GetMetricDataCommand({
      MetricDataQueries: queries,
      StartTime: from,
      EndTime: new Date(from.getTime() + period * 1000),
    }),
  );
  const value = (id: string) =>
    (MetricDataResults.find((r) => r.Id === id)?.Values ?? []).reduce((a, b) => a + b, 0);
  const stats = (track: string): TrackStats => ({
    requests: value(`requests_${track}`),
    errors: value(`errors_${track}`),
    rejected: value(`rejected_${track}`),
    p95Ms: value(`latency_${track}`) * 1000,
  });

  const { MetricAlarms = [] } = await client.send(
    new DescribeAlarmsCommand({ AlarmNames: gate.alarms, StateValue: 'ALARM' }),
  );
  return {
    stable: stats('stable'),
    canary: stats('canary'),
    firing: MetricAlarms.map((a) => a.AlarmName),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      start: { type: 'string' },
      end: { type: 'string' },
      gate: { type: 'string' },
    },
  });
  const gate = JSON.parse(values.gate!) as GateTargets;
  const { stable, canary, firing } = await measure(
    gate,
    new Date(values.start!),
    new Date(values.end!),
  );

  const verdict = firing.length
    ? { decision: 'abort' as const, reasons: firing.map((name) => `alarm ${name} firing`) }
    : decide(canary, stable);

  const row = (track: string, t: TrackStats) =>
    `| ${track} | ${t.requests} | ${(100 * rate(t.errors, t)).toFixed(2)}% ` +
    `| ${(100 * rate(t.rejected, t)).toFixed(2)}% | ${t.p95Ms.toFixed(0)} |`;
  const summary = [
    '| track | requests | 5xx | 4xx | p95 ms |',
    '|---|---|---|---|---|',
    row('stable', stable),
    row('canary', canary),
    '',
    `**${verdict.decision.toUpperCase()}**: ${verdict.reasons.join('; ')}`,
  ].join('\n');

  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n\n`);
  }
  process.exitCode = { promote: 0, pause: 3, abort: 4 }[verdict.decision];
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
}
