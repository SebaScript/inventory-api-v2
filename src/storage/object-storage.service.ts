import { Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** The link is the only way into a private bucket, so it expires fast. */
export const URL_EXPIRY_SECONDS = 900;

export interface StoredObject {
  key: string;
  bytes: number;
  url: string;
  expiresInSeconds: number;
}

/** The only code that talks to S3: encrypted writes and short-lived links. */
@Injectable()
export class ObjectStorageService {
  private readonly client?: S3Client;
  private readonly bucket?: string;

  constructor() {
    // Without a bucket no client is built, so tests need no credentials.
    this.bucket = process.env.S3_BUCKET;
    if (this.bucket) this.client = new S3Client({});
  }

  get configured(): boolean {
    return this.client !== undefined && this.bucket !== undefined;
  }

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

    // Signed with the pod's permissions: the role needs GetObject too.
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: URL_EXPIRY_SECONDS },
    );

    return { key, bytes: Buffer.byteLength(body), url, expiresInSeconds: URL_EXPIRY_SECONDS };
  }
}
