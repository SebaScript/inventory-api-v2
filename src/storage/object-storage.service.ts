import { Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Short on purpose: the link is the only access path to a private bucket. */
export const URL_EXPIRY_SECONDS = 900;

export interface StoredObject {
  key: string;
  bytes: number;
  url: string;
  expiresInSeconds: number;
}

/**
 * The one place that talks to the bucket. Shared by the CSV export and by the
 * flow attachments, so both write encrypted objects and hand back the same
 * kind of short-lived link.
 */
@Injectable()
export class ObjectStorageService {
  private readonly client?: S3Client;
  private readonly bucket?: string;

  constructor() {
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

  /** Callers check `configured` first: each decides whether a missing bucket is an error. */
  async put(key: string, body: string, contentType: string): Promise<StoredObject> {
    if (!this.client || !this.bucket) throw new Error('Object storage is not configured');

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
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

    return { key, bytes: Buffer.byteLength(body), url, expiresInSeconds: URL_EXPIRY_SECONDS };
  }
}
