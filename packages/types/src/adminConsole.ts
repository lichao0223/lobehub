import type { AiModelType } from 'model-bank';

/**
 * Admin console (CUST-008) shared types.
 *
 * P1 ships user management; the settings table carries a single jsonb `config`
 * so P2 (Tellhow model service) extends it without a new migration. Timestamps
 * in the stored config are ISO strings, which keeps the jsonb payload readable
 * and lets the API hand `updatedAt` back for optimistic locking.
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

// ── P2 model service ─────────────────────────────────────────────────────

/** Extra model abilities the console exposes; the model type stays `AiModelType`. */
export const COMPANY_MODEL_CAPABILITIES = ['vision', 'functionCall', 'reasoning'] as const;
export type CompanyModelCapability = (typeof COMPANY_MODEL_CAPABILITIES)[number];

/**
 * One model in the company catalog.
 *
 * `type` is the 9-value `AiModelType` enum; vision understanding is a
 * capability of a chat model, not a type of its own. `source` records whether
 * the row came from a catalog sync or was added by hand, and `removedAt` keeps
 * upstream removals visible instead of deleting the row.
 */
export interface CompanyModel {
  capabilities?: CompanyModelCapability[];
  contextWindowTokens?: number;
  /** Request body model id. */
  id: string;
  /** Display name shown to users. */
  name: string;
  /** Whether the model is offered to every user. */
  open: boolean;
  /** Metadata still needs an admin decision (catalog sync default). */
  pending?: boolean;
  /** Set when the upstream catalog no longer lists the model. */
  removedAt?: string;
  source: 'sync' | 'manual';
  type: AiModelType;
}

/** Optional system-task defaults; they only affect newly created users. */
export interface AdminConsoleAiDefaults {
  /** Model id for new users' default chat model. */
  chat?: string;
  /** Model id for memory / knowledge embeddings. */
  embedding?: string;
  /** Model id for title generation. */
  title?: string;
  /** Model id for task verification. */
  verify?: string;
}

/** Result of the last connection test. */
export interface AdminConsoleAiLastTest {
  at: string;
  errorCode?: string;
  latencyMs?: number;
  modelCount?: number;
  ok: boolean;
}

/**
 * Stored API key. `ciphertext` comes from the existing KeyVaults gatekeeper and
 * must never leave the server; read paths return `AdminConsoleAiKeySummary`.
 */
export interface AdminConsoleAiKey {
  ciphertext: string;
  last4: string;
  updatedAt: string;
  updatedBy: string;
}

/** What an admin read may see about the stored key. */
export interface AdminConsoleAiKeySummary {
  last4: string;
  updatedAt: string;
  updatedBy: string;
}

/** Stored `config.ai` shape. */
export interface AdminConsoleAiConfig {
  apiKey: AdminConsoleAiKey | null;
  baseURL: string;
  defaults?: AdminConsoleAiDefaults;
  enabled: boolean;
  lastTest?: AdminConsoleAiLastTest;
  models: CompanyModel[];
}

/** `config.ai` as returned by the admin endpoints: the key is reduced to last4. */
export interface AdminConsoleAiConfigView {
  apiKey: AdminConsoleAiKeySummary | null;
  baseURL: string;
  defaults?: AdminConsoleAiDefaults;
  enabled: boolean;
  lastTest?: AdminConsoleAiLastTest;
  models: CompanyModel[];
}

/** Read result, including the row version used for optimistic locking. */
export interface AdminConsoleModelServiceConfig {
  config: AdminConsoleAiConfigView;
  /** ISO timestamp of the settings row; `null` when it was never written. */
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Write shape. Omitted fields keep their stored value, so the page can rotate
 * only the key or only the catalog. A supplied `apiKey` is plaintext on the
 * wire, encrypted before it is stored, and never echoed back.
 */
export interface AdminConsoleAiConfigUpdate {
  /** Plaintext key to rotate; omit to keep the stored key. */
  apiKey?: string;
  baseURL?: string;
  defaults?: AdminConsoleAiDefaults;
  enabled: boolean;
  expectedUpdatedAt?: string;
  models?: CompanyModel[];
}

export interface AdminConsoleSettingsConfig {
  ai?: AdminConsoleAiConfig;
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
  configConflict: 'CONFIG_CONFLICT',
  duplicateModelId: 'DUPLICATE_MODEL_ID',
  invalidApiKey: 'INVALID_API_KEY',
  invalidBaseUrl: 'INVALID_BASE_URL',
  invalidDefaultModel: 'INVALID_DEFAULT_MODEL',
  invalidModel: 'INVALID_MODEL',
  invalidModelType: 'INVALID_MODEL_TYPE',
  lastAdmin: 'LAST_ADMIN',
  providerNotConfigured: 'PROVIDER_NOT_CONFIGURED',
  selfLockout: 'SELF_LOCKOUT',
} as const;
