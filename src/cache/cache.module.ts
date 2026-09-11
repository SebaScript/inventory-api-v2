import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

/**
 * Global on purpose. The cache is leaf infrastructure that three unrelated
 * services and one controller need; the alternative is adding an import to
 * every feature module for a dependency none of them own.
 */
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
