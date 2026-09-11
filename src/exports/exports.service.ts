import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { ExportUnavailableException } from '../common/exceptions';
import { Item } from '../entities/item.entity';
import { toCsv } from './csv';

const PREFIX = 'exports';
/** Short on purpose: the link is the only access path to a private bucket. */
const URL_EXPIRY_SECONDS = 900;

export interface ExportResult {
  key: string;
  rows: number;
  bytes: number;
  url: string;
  expiresInSeconds: number;
}

@Injectable()
export class ExportsService {
  private readonly client?: S3Client;
  private readonly bucket?: string;

  constructor(@InjectRepository(Item) private readonly items: Repository<Item>) {
    // Read here rather than at module scope: dotenv is loaded by app.module.ts,
    // which runs after this file is imported.
    this.bucket = process.env.S3_BUCKET;
    // Built only when a bucket is configured, so nothing resolves credentials
    // during the test suite.
    if (this.bucket) this.client = new S3Client({});
  }

  get configured(): boolean {
    return this.client !== undefined && this.bucket !== undefined;
  }

  /** Snapshots the inventory to object storage and hands back a temporary link. */
  async exportItems(): Promise<ExportResult> {
    if (!this.client || !this.bucket) throw new ExportUnavailableException();

    const items = await this.items.find({ relations: { group: true }, order: { id: 'ASC' } });
    const body = toCsv(items);
    const key = `${PREFIX}/items-${new Date().toISOString()}-${randomUUID()}.csv`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'text/csv; charset=utf-8',
        ServerSideEncryption: 'AES256',
      }),
    );

    // A presigned URL carries the signer's own permissions, so the pod role
    // needs GetObject even though it is the client that downloads the file.
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: URL_EXPIRY_SECONDS },
    );

    return {
      key,
      rows: items.length,
      bytes: Buffer.byteLength(body),
      url,
      expiresInSeconds: URL_EXPIRY_SECONDS,
    };
  }
}
