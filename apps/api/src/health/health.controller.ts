import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { SkipInternalKey } from '../common/decorators/skip-internal-key.decorator.js';
import { DB, type Database } from '../database/database.types.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @Public()
  @SkipInternalKey()
  async check(@Res({ passthrough: true }) response: Response): Promise<{ status: string }> {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok' };
    } catch {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'unavailable' };
    }
  }
}
