import type { AiModelType } from 'model-bank';

import type { ManagedDevicePhase } from './managedDevice';

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

/**
 * Outcome of one `GET {baseURL}/models` probe (§5.2 / §5.6).
 *
 * `latencyMs` is measured to the response headers (or to the failure), and the
 * error code is a stable `ADMIN_CONSOLE_ERROR` value so the page can localize
 * it instead of rendering an upstream body.
 */
export interface AdminConsoleConnectionTestResult {
  errorCode?: string;
  latencyMs?: number;
  modelCount?: number;
  ok: boolean;
}

/**
 * Diff between the stored catalog and the upstream `/models` list (§5.4).
 *
 * Additions are closed by default (`open: false`, `pending: true`); removals
 * are stamped with `removedAt` and never deleted; `needsReview` lists the ids
 * whose type fell back to the default and need an administrator decision.
 */
export interface AdminConsoleCatalogDiff {
  added: CompanyModel[];
  needsReview: string[];
  /** Rows upstream no longer lists: kept, stamped with `removedAt`. */
  removed: CompanyModel[];
  /** Previously removed rows that upstream lists again. */
  restored: CompanyModel[];
  /** Ids identical on both sides. */
  unchanged: string[];
  /** Rows whose missing metadata was filled from the built-in catalog. */
  updated: CompanyModel[];
}

/** `refreshModelCatalog` result: the diff, plus whether it was written. */
export interface AdminConsoleCatalogSyncResult {
  applied: boolean;
  diff: AdminConsoleCatalogDiff;
  /** Row version after a write; `null` when the settings row is missing. */
  updatedAt: string | null;
  upstreamModelCount: number;
}

// ── CUST-009 unified Labs switch ─────────────────────────────────────────

/**
 * Who owns the lab flags of this deployment.
 *
 * `user` (default) keeps the upstream per-user Labs settings page; `admin`
 * replaces every user's `preference.lab` with this console's flags at read
 * time, so the upstream flag chain (`labPreferSelectors` and the server gates)
 * keeps working without a second feature-flag list.
 */
export type AdminConsoleLabsMode = 'user' | 'admin';

/**
 * Stored `config.labs`. `flags` is sparse: it only carries values that differ
 * from `DEFAULT_PREFERENCE.lab`, so an unset flag means "off" in `admin` mode
 * and never falls back to the user's own preference.
 */
export interface AdminConsoleLabsConfig {
  flags: Record<string, boolean>;
  mode: AdminConsoleLabsMode;
}

/** `config.labs` as returned by the admin endpoints, with the row version. */
export interface AdminConsoleLabsConfigView extends AdminConsoleLabsConfig {
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Write shape; omitted `flags` keeps the stored map. */
export interface AdminConsoleLabsConfigUpdate {
  expectedUpdatedAt?: string;
  flags?: Record<string, boolean>;
  mode: AdminConsoleLabsMode;
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
  /** CUST-009: deployment-wide Labs switch. */
  labs?: AdminConsoleLabsConfig;
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

/** Outcome of a physical account deletion (CUST-008 P1). */
export interface AdminUserDeleteResult {
  /** `files` rows the account owned when it was deleted. */
  deletedFiles: number;
  /** Stored objects reclaimed from the file storage backend. */
  removedObjects: number;
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
  /** A deletion target still carries the admin role (demote it first). */
  adminProtected: 'ADMIN_PROTECTED',
  /** A pending agent transfer must drain before the account can be deleted. */
  agentTransferPending: 'AGENT_TRANSFER_PENDING',
  configConflict: 'CONFIG_CONFLICT',
  duplicateModelId: 'DUPLICATE_MODEL_ID',
  invalidApiKey: 'INVALID_API_KEY',
  invalidBaseUrl: 'INVALID_BASE_URL',
  invalidDefaultModel: 'INVALID_DEFAULT_MODEL',
  invalidLabsConfig: 'INVALID_LABS_CONFIG',
  invalidModel: 'INVALID_MODEL',
  invalidModelType: 'INVALID_MODEL_TYPE',
  lastAdmin: 'LAST_ADMIN',
  providerAuthFailed: 'PROVIDER_AUTH_FAILED',
  providerHttpError: 'PROVIDER_HTTP_ERROR',
  providerInvalidResponse: 'PROVIDER_INVALID_RESPONSE',
  providerNotConfigured: 'PROVIDER_NOT_CONFIGURED',
  providerTimeout: 'PROVIDER_TIMEOUT',
  providerUnreachable: 'PROVIDER_UNREACHABLE',
  selfLockout: 'SELF_LOCKOUT',
} as const;

// ── CUST-010 cross-user device overview (read-only) ──────────────────────
//
// The console lists every device row in the deployment — personal devices of
// every user plus every workspace enrollment, including other members'
// `private` rows — because an administrator's job is machine inventory, not
// per-user self-service. The device layer itself is upstream-owned and stays
// untouched: these types are a read-only projection of `devices` decorated
// with owner / workspace display info, and they are the single place that
// encodes what an admin read is allowed to see (see `AdminDeviceDetail`).

/** Which principal owns a device row (`devices.workspace_id` is null or not). */
export type AdminDeviceScope = 'personal' | 'workspace';

/**
 * Three-state presence. `unknown` is a first-class answer, not a synonym for
 * `offline`: it means the gateway was not configured or the probe failed, and
 * the page must render it as "unknown" rather than inventing an offline state.
 */
export type AdminDeviceOnlineState = 'online' | 'offline' | 'unknown';

/**
 * Visibility of a WORKSPACE-scoped device (upstream `DeviceVisibility`).
 * Personal devices have no visibility dimension: they are implicitly private
 * to their owner, so a personal row carries `null`.
 */
export type AdminDeviceVisibility = 'private' | 'public';

/** Owner display info, resolved server-side so the list needs one round-trip. */
export interface AdminDeviceOwner {
  avatar: string | null;
  email?: string | null;
  fullName: string | null;
  userId: string;
  username: string | null;
}

/**
 * Workspace a device is enrolled into, or `null` for a personal device.
 *
 * `name`/`slug` are display-only joins; the identity of the row is
 * (`workspaceId`, `deviceId`), never the name.
 */
export type AdminDeviceWorkspace = {
  name: string;
  slug?: string;
  workspaceId: string;
} | null;

/** One live gateway connection, reduced to the two fields the console shows. */
export interface AdminDeviceChannel {
  /** Gateway channel label; `null` on legacy gateways that omit it. */
  channel: string | null;
  connectedAt: Date;
}

/**
 * One row of the admin device list — the whole deployment, any owner.
 *
 * Presence is `AdminDeviceOnlineState`, never a boolean: the page must be able
 * to say "unknown" when the device gateway is unreachable.
 */
export interface AdminDeviceSummary {
  /** CPU architecture as reported by the client; `null` on rows that predate it. */
  architecture: string | null;
  /** Live gateway channels at read time; `0` for offline and unknown rows. */
  channelCount: number;
  deviceId: string;
  firstSeenAt: Date;
  friendlyName: string | null;
  hostname: string | null;
  /** `'machine-id'`, `'fallback'` or the managed-cloud value. */
  identitySource: string;
  lastSeenAt: Date;
  online: AdminDeviceOnlineState;
  owner: AdminDeviceOwner;
  platform: string | null;
  scope: AdminDeviceScope;
  /**
   * Workspace rows only: the personal deviceId this enrollment was shared
   * from (`devices.shared_from_device_id`). `null` for personal rows and for
   * machines enrolled directly with `lh connect --workspace`.
   */
  sharedFromDeviceId: string | null;
  /** `null` for personal rows — they are private to their owner by definition. */
  visibility: AdminDeviceVisibility | null;
  /** `null` for personal devices. */
  workspace: AdminDeviceWorkspace;
}

/**
 * Device detail, with the admin privacy whitelist fixed at the type level.
 *
 * This shape deliberately has NO `defaultCwd`, `workingDirs` or `recentCwds`:
 * filesystem paths from another user's machine are not an administrator's
 * business, and a field that is absent from the type cannot leak through a
 * later implementation that "just returns the row".
 *
 * `devices.metadata` is likewise never returned wholesale. Only the known keys
 * listed in {@link ADMIN_DEVICE_DETAIL_METADATA_KEYS} are projected, each as
 * its own top-level field (`appVersion`, `cliVersion`); an unknown metadata key
 * has no field and therefore no way out.
 */
export interface AdminDeviceDetail extends AdminDeviceSummary {
  /** `metadata.appVersion` of the last connect; absent for CLI/ghost rows. */
  appVersion?: string;
  channels: AdminDeviceChannel[];
  /** `metadata.cliVersion` of the last connect; absent for desktop rows. */
  cliVersion?: string;
  /** Whether the device carries a fixed agent binding (never the binding itself). */
  hasFixedAgentBinding?: boolean;
  /** Managed cloud devices only; absent for regular machines. */
  managedPhase?: ManagedDevicePhase;
}

/** `metadata` keys the detail projection may read; nothing else is exposed. */
export const ADMIN_DEVICE_DETAIL_METADATA_KEYS = ['appVersion', 'cliVersion'] as const;

export type AdminDeviceDetailMetadataKey = (typeof ADMIN_DEVICE_DETAIL_METADATA_KEYS)[number];

/** Hard cap for {@link AdminDeviceListParams.pageSize}; the server clamps to it. */
export const ADMIN_DEVICE_MAX_PAGE_SIZE = 100;

/** Admin list query. Every filter is optional and ANDed. */
export interface AdminDeviceListParams {
  online?: AdminDeviceOnlineState;
  page?: number;
  /** Rows per page, clamped to {@link ADMIN_DEVICE_MAX_PAGE_SIZE}. */
  pageSize?: number;
  /** Exact match on the reported platform (`darwin` / `win32` / `linux`). */
  platform?: string;
  /** Search across friendly name, hostname and owner username / email. */
  q?: string;
  scope?: AdminDeviceScope;
  /**
   * Workspace rows only. Personal rows carry no visibility, so setting this
   * narrows the result to workspace enrollments.
   */
  visibility?: AdminDeviceVisibility;
  workspaceId?: string;
}

/** Presence tally for the current filter, computed over the whole result. */
export interface AdminDeviceOnlineStats {
  offline: number;
  online: number;
  unknown: number;
}

export interface AdminDeviceListResult {
  items: AdminDeviceSummary[];
  onlineStats: AdminDeviceOnlineStats;
  page: number;
  pageSize: number;
  total: number;
}

/** Header counters for the overview page; independent of the current filter. */
export interface AdminDeviceStats {
  /** Devices whose `lastSeenAt` falls inside the last 7 days. */
  activeLast7d: number;
  byPlatform: Record<string, number>;
  personal: number;
  total: number;
  workspace: number;
  /** Distinct workspaces with at least one enrolled device. */
  workspaceCount: number;
}
