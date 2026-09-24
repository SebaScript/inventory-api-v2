import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

/** Global: several unrelated modules need it. */
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
