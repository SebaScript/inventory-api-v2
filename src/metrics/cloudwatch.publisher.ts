import { CloudWatchClient, MetricDatum, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { release } from '../common/release';
import { movementsRecorded } from './registry';

const INTERVAL_MS = 60_000;

/** One minute of a track: its memory, and how many movements it recorded. */
export function trackMetrics(track: string, rssBytes: number, movements: number): MetricDatum[] {
  const Dimensions = [{ Name: 'Track', Value: track }];
  return [
    { MetricName: 'MemoryUsedMB', Unit: 'Megabytes', Value: rssBytes / 2 ** 20, Dimensions },
    { MetricName: 'MovementsRecorded', Unit: 'Count', Value: movements, Dimensions },
  ];
}

/**
 * What the load balancer cannot see, per track, once a minute. Off without
 * CW_NAMESPACE, so tests and local runs never call AWS.
 */
@Injectable()
export class CloudWatchPublisher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CloudWatchPublisher.name);
  private readonly namespace = process.env.CW_NAMESPACE;
  private readonly client = this.namespace ? new CloudWatchClient({}) : undefined;
  private timer?: NodeJS.Timeout;
  private movementsSoFar = 0;

  onApplicationBootstrap(): void {
    if (this.client) this.timer = setInterval(() => void this.publish(), INTERVAL_MS).unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async publish(): Promise<void> {
    const total = (await movementsRecorded.get()).values[0]?.value ?? 0;
    const movements = total - this.movementsSoFar;
    this.movementsSoFar = total;

    try {
      await this.client!.send(
        new PutMetricDataCommand({
          Namespace: this.namespace,
          MetricData: trackMetrics(release.track, process.memoryUsage().rss, movements),
        }),
      );
    } catch (error) {
      // A metric lost is a gap in a graph, never a reason to fail requests.
      this.logger.warn(`CloudWatch metrics not sent: ${(error as Error).message}`);
    }
  }
}
