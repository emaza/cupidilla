import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['service_use'] }).notNull(),
    policyVersion: text('policy_version').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('consents_user_id_idx').on(t.userId),
    uniqueIndex('consents_one_active_per_purpose')
      .on(t.userId, t.purpose)
      .where(sql`${t.revokedAt} is null`),
    check('consents_purpose_known', sql`${t.purpose} in ('service_use')`),
    check('consents_policy_version_length', sql`char_length(${t.policyVersion}) between 1 and 64`),
    check(
      'consents_revoked_after_granted',
      sql`${t.revokedAt} is null or ${t.revokedAt} >= ${t.grantedAt}`,
    ),
  ],
);
