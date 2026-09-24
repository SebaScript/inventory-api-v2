import { ApiProperty } from '@nestjs/swagger';

export const SERVICE_NAME = 'inventory-api';

/** The shape both clouds agree on. Domain-agnostic: neither API knows the other's model. */
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

/** Reports a status instead of throwing: the other cloud must never break a local read. */
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

/** The orchestrator's message. Unknown fields belong to other steps and pass through. */
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
