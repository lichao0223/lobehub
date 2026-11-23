import type { AdminConsoleSettingsConfig } from '@lobechat/types';
import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { timestamptz } from './_helpers';

/**
 * Fork-owned singleton settings for the admin console (CUST-008).
 *
 * One row (`id = 'singleton'`) holds a jsonb `config`: P1 records the first
 * bootstrap promotion, P2 adds the Tellhow model-service configuration. The
 * console never writes upstream user tables for its own configuration.
 */
export const adminConsoleSettings = pgTable('admin_console_settings', {
  id: text('id').primaryKey().notNull(),
  config: jsonb('config').$type<AdminConsoleSettingsConfig>().notNull().default({}),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  updatedBy: text('updated_by').notNull(),
});

export type AdminConsoleSettingsItem = typeof adminConsoleSettings.$inferSelect;
export type NewAdminConsoleSettingsItem = typeof adminConsoleSettings.$inferInsert;
