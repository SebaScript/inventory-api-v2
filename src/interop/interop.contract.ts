import { ApiProperty } from '@nestjs/swagger';

/** How this service names itself to the other cloud. */
export const SERVICE_NAME = 'inventory-api';

/**
 * The one shape both clouds agree on.
 *
 * Deliberately says nothing about inventories, orders or any other domain: each
 * side maps whichever entity it wants into these five fields, so neither API has
 * to know the other's model. `attributes` is the escape hatch for the two or
 * three values worth showing, and stays flat and small on purpose.
 */
export class InteropRecord {
  @ApiProperty({ example: SERVICE_NAME, description: 'Which API this came from' })
  source: string;

  @ApiProperty({ example: 'item', description: 'Which entity it represents' })
  kind: string;

  @ApiProperty({ example: '3' })
  id: string;

  @ApiProperty({ example: 'USB-C Hub', description: 'Something a human can read' })
  label: string;

  @ApiProperty({
    example: { sku: 'ELEC-HUB', quantity: 0, unitPrice: 45, group: 'Electronics' },
    description: 'A handful of flat values, nothing nested',
  })
  attributes: Record<string, string | number | boolean | null>;

  @ApiProperty({ example: '2026-09-16T23:40:00.000Z' })
  retrievedAt: string;
}

/**
 * What a lookup against the other cloud produced. It reports its own status
 * rather than throwing, because the partner being unreachable must never turn
 * a perfectly good local read into an error.
 */
export class PartnerLookup {
  @ApiProperty({
    enum: ['ok', 'unavailable', 'disabled'],
    description:
      '`disabled` means no orchestrator is configured, so nothing was even ' +
      'attempted; `unavailable` means it was asked and did not answer in time.',
  })
  status: 'ok' | 'unavailable' | 'disabled';

  @ApiProperty({ type: InteropRecord, nullable: true })
  record: InteropRecord | null;
}

/** A file this API wrote while the message passed through it. */
export class FlowAttachment {
  @ApiProperty({ example: SERVICE_NAME })
  source: string;

  @ApiProperty({ example: 'flows/3f2c9a1e/2026-09-22T21:00:00.000Z-inventory-api.json' })
  key: string;

  @ApiProperty({ description: 'Presigned link; the bucket itself stays private' })
  url: string;

  @ApiProperty({ example: 900 })
  expiresInSeconds: number;
}

/**
 * The message the orchestrator carries from one API to the next. Only the
 * fields this API writes are described: anything else in it belongs to the
 * other steps and is passed through as it came.
 */
export class FlowMessage {
  [key: string]: unknown;

  @ApiProperty({ required: false, example: '3f2c9a1e' })
  correlationId?: string;

  @ApiProperty({
    type: [InteropRecord],
    description: 'One entity added by each API the message went through',
  })
  entities: unknown[];

  @ApiProperty({ type: [FlowAttachment] })
  attachments: FlowAttachment[];
}
