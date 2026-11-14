import { CloudWatchClient, MetricDatum, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { drainPartnerCalls } from './partner-calls';
import { movementsRecorded, partnerLookups } from './registry';

const INTERVAL_MS = 60_000;

/** Every outcome is published each minute, zero included, so the graphs have no holes. */
export const PARTNER_OUTCOMES = ['ok', 'cached', 'unavailable'] as const;

/** CloudWatch takes at most 150 distinct values per datum: coarser steps until they fit. */
export function valuesAndCounts(samples: number[]): { Values: number[]; Counts: number[] } {
  let step = 1;
  let counts = new Map<number, number>();
  do {
    counts = new Map();
    for (const sample of samples) {
      const value = Math.round(sample / step) * step;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    step *= 10;
  } while (counts.size > 150);

  return { Values: [...counts.keys()], Counts: [...counts.values()] };
}

/** One minute of what only the app can measure: memory, business, and the calls to the other cloud. */
export function minuteMetrics(
  rssBytes: number,
  movements: number,
  partnerOutcomes: Record<string, number>,
  partnerCallsMs: number[],
): MetricDatum[] {
  const data: MetricDatum[] = [
    { MetricName: 'MemoryUsedMB', Unit: 'Megabytes', Value: rssBytes / 2 ** 20 },
    { MetricName: 'MovementsRecorded', Unit: 'Count', Value: movements },
    ...PARTNER_OUTCOMES.map((outcome) => ({
      MetricName: 'PartnerCalls',
      Unit: 'Count' as const,
      Value: partnerOutcomes[outcome] ?? 0,
      Dimensions: [{ Name: 'Outcome', Value: outcome }],
    })),
  ];

  if (partnerCallsMs.length > 0) {
    data.push({
      MetricName: 'PartnerCallDuration',
      Unit: 'Milliseconds',
      ...valuesAndCounts(partnerCallsMs),
    });
  }
  return data;
}

/** A counter's growth since the last reading, per label value. */
class Deltas {
  private last = new Map<string, number>();

  take(current: Map<string, number>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of current) result[key] = value - (this.last.get(key) ?? 0);
    this.last = current;
    return result;
  }
}

/**
 * What the load balancer cannot see, once a minute. Off without CW_NAMESPACE,
 * so tests and local runs never call AWS.
 */
@Injectable()
export class CloudWatchPublisher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CloudWatchPublisher.name);
  private readonly namespace = process.env.CW_NAMESPACE;
  private readonly client = this.namespace ? new CloudWatchClient({}) : undefined;
  private timer?: NodeJS.Timeout;
  private readonly movements = new Deltas();
  private readonly outcomes = new Deltas();

  onApplicationBootstrap(): void {
    if (this.client) this.timer = setInterval(() => void this.publish(), INTERVAL_MS).unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async publish(): Promise<void> {
    const movements = this.movements.take(
      new Map([['all', (await movementsRecorded.get()).values[0]?.value ?? 0]]),
    );
    const outcomes = this.outcomes.take(
      new Map((await partnerLookups.get()).values.map((v) => [String(v.labels.outcome), v.value])),
    );

    try {
      await this.client!.send(
        new PutMetricDataCommand({
          Namespace: this.namespace,
          MetricData: minuteMetrics(
            process.memoryUsage().rss,
            movements.all ?? 0,
            outcomes,
            drainPartnerCalls(),
          ),
        }),
      );
    } catch (error) {
      // A metric lost is a gap in a graph, never a reason to fail requests.
      this.logger.warn(`CloudWatch metrics not sent: ${(error as Error).message}`);
    }
  }
}
