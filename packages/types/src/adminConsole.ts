/**
 * Admin console (CUST-008) shared types.
 *
 * P1 only ships user management; the settings table carries a single jsonb
 * `config` so P2 (Tellhow model service) can extend it without a new migration.
 */

/** The settings table is a singleton: exactly one row with this id. */
export const ADMIN_CONSOLE_SETTINGS_ID = 'singleton' as const;

/** Account roles the console writes. Better Auth stores them in `users.role`. */
export const ADMIN_ROLES = ['admin', 'user'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Recorded the first time an env-configured account is promoted. */
export interface AdminConsoleBootstrapRecord {
  at: string;
  userId: string;
}

export interface AdminConsoleSettingsConfig {
  /** Set once `ADMIN_CONSOLE_BOOTSTRAP_*` promoted an account. */
  bootstrap?: AdminConsoleBootstrapRecord;
}

export type AdminConsoleUserStatus = 'active' | 'banned';

export interface AdminUserSummary {
  avatar: string | null;
  banned: boolean;
  createdAt: Date;
  email: string | null;
  fullName: string | null;
  id: string;
  lastActiveAt: Date;
  role: AdminRole;
  username: string | null;
}

export interface AdminUserDetail extends AdminUserSummary {
  banExpires: Date | null;
  banReason: string | null;
  emailVerified: boolean;
}

export interface AdminUserListParams {
  page?: number;
  pageSize?: number;
  /** Search across email, username, and display name. */
  q?: string;
  /** `all` (default) or a concrete role. */
  role?: 'admin' | 'user';
  status?: 'active' | 'banned';
}

export interface AdminUserListResult {
  items: AdminUserSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminWhoamiResult {
  /** Whether the env allow-list could promote this account at all. */
  bootstrapConfigured: boolean;
  /** Whether this account is (now) eligible for lazy promotion. */
  canBootstrap: boolean;
  isAdmin: boolean;
  role: AdminRole;
}

/** Error messages the frontend matches on instead of parsing localized text. */
export const ADMIN_CONSOLE_ERROR = {
  adminRequired: 'ADMIN_REQUIRED',
  lastAdmin: 'LAST_ADMIN',
  selfLockout: 'SELF_LOCKOUT',
} as const;
