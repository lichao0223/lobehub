import type {
  AdminConsoleLabsConfig,
  AdminConsoleSettingsConfig,
  AdminDeviceDetail,
  AdminDeviceListParams,
  AdminDeviceListResult,
  AdminDeviceStats,
  AdminDeviceSummary,
  AdminDeviceVisibility,
  AdminRole,
  AdminUserDetail,
  AdminUserListParams,
  AdminUserListResult,
  AdminUserSummary,
  AdminWorkspaceListResult,
  AdminWorkspaceMember,
} from '@lobechat/types';
import { ADMIN_CONSOLE_SETTINGS_ID, ADMIN_DEVICE_MAX_PAGE_SIZE } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import type { AdminConsoleSettingsItem } from '../schemas';
import {
  adminConsoleSettings,
  agents,
  apiKeys,
  devices,
  session,
  users,
  workspaceMembers,
  workspaces,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { AGENT_TRANSFER_PENDING_OWNER_DELETE } from './agentTransferJob';
import { UserModel } from './user';

/** Better Auth stores `role` as free text; anything but `admin` is a normal user. */
export const normalizeAdminRole = (role: string | null | undefined): AdminRole =>
  role === 'admin' ? 'admin' : 'user';

/** An account counts as an enabled admin when it is admin and not banned. */
const isActiveAdmin = () => and(eq(users.role, 'admin'), ne(users.banned, true));

const notBanned = () => or(isNull(users.banned), eq(users.banned, false));

const displayName = (row: {
  firstName: string | null;
  fullName: string | null;
  lastName: string | null;
}) => {
  if (row.fullName) return row.fullName;
  const joined = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  return joined || null;
};

const toSummary = (row: {
  avatar: string | null;
  banned: boolean | null;
  createdAt: Date;
  email: string | null;
  firstName: string | null;
  fullName: string | null;
  id: string;
  lastActiveAt: Date;
  lastName: string | null;
  role: string | null;
  username: string | null;
}): AdminUserSummary => ({
  avatar: row.avatar,
  banned: row.banned === true,
  createdAt: row.createdAt,
  email: row.email,
  fullName: displayName(row),
  id: row.id,
  lastActiveAt: row.lastActiveAt,
  role: normalizeAdminRole(row.role),
  username: row.username,
});

/**
 * Columns shared by the admin device list and detail reads.
 *
 * This is the privacy boundary at the SQL layer: `defaultCwd`, `workingDirs`,
 * `recentCwds` and the raw `metadata` column are never selected, so no later
 * mapping can accidentally forward another user's filesystem paths. Detail
 * reads project the two whitelisted metadata keys explicitly.
 */
const adminDeviceSelection = {
  architecture: devices.architecture,
  deviceId: devices.deviceId,
  firstSeenAt: devices.firstSeenAt,
  friendlyName: devices.friendlyName,
  hostname: devices.hostname,
  identitySource: devices.identitySource,
  lastSeenAt: devices.lastSeenAt,
  ownerAvatar: users.avatar,
  ownerEmail: users.email,
  ownerFullName: users.fullName,
  ownerId: users.id,
  ownerUsername: users.username,
  platform: devices.platform,
  sharedFromDeviceId: devices.sharedFromDeviceId,
  visibility: devices.visibility,
  workspaceId: devices.workspaceId,
  workspaceName: workspaces.name,
  workspaceSlug: workspaces.slug,
};

type AdminDeviceRow = {
  architecture: string | null;
  deviceId: string;
  firstSeenAt: Date;
  friendlyName: string | null;
  hostname: string | null;
  identitySource: string;
  lastSeenAt: Date;
  ownerAvatar: string | null;
  ownerEmail: string | null;
  ownerFullName: string | null;
  ownerId: string | null;
  ownerUsername: string | null;
  platform: string | null;
  sharedFromDeviceId: string | null;
  visibility: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceSlug: string | null;
};

/**
 * Map one joined device row to the admin list shape.
 *
 * Presence (`online`, `channelCount`) is live gateway state that lives outside
 * this table, so the model answers `unknown` / `0`; the admin interface layer
 * overwrites both after probing the gateway. Never a boolean: "gateway
 * unreachable" must stay distinguishable from "device offline".
 */
const toAdminDeviceSummary = (row: AdminDeviceRow): AdminDeviceSummary => ({
  architecture: row.architecture,
  channelCount: 0,
  deviceId: row.deviceId,
  firstSeenAt: row.firstSeenAt,
  friendlyName: row.friendlyName,
  hostname: row.hostname,
  identitySource: row.identitySource,
  lastSeenAt: row.lastSeenAt,
  online: 'unknown',
  owner: {
    avatar: row.ownerAvatar,
    email: row.ownerEmail,
    fullName: row.ownerFullName,
    userId: row.ownerId ?? '',
    username: row.ownerUsername,
  },
  platform: row.platform,
  scope: row.workspaceId ? 'workspace' : 'personal',
  sharedFromDeviceId: row.sharedFromDeviceId,
  // Personal rows are implicitly private to their owner, so the column value
  // is not surfaced for them (see `AdminDeviceVisibility`).
  visibility: row.workspaceId ? (row.visibility as AdminDeviceVisibility | null) : null,
  workspace: row.workspaceId
    ? {
        // FK cascade removes the device with its workspace, so a missing name
        // is only reachable through a mid-transaction read.
        name: row.workspaceName ?? row.workspaceId,
        slug: row.workspaceSlug ?? undefined,
        workspaceId: row.workspaceId,
      }
    : null,
});

/**
 * Admin list filter over `devices`, joined with `users` / `workspaces`.
 *
 * No workspace or owner scoping: the administrator sees the whole deployment,
 * including other members' `private` workspace enrollments — that is the point
 * of the console view and the opposite of `DeviceModel.queryPersonal`.
 *
 * `params.online` is intentionally not translated to SQL: presence is live
 * gateway state, so the interface layer narrows it after probing.
 */
const adminDeviceWhere = (params: AdminDeviceListParams) => {
  const keyword = params.q?.trim();

  const conditions = [
    keyword
      ? or(
          ilike(devices.friendlyName, `%${keyword}%`),
          ilike(devices.hostname, `%${keyword}%`),
          ilike(users.username, `%${keyword}%`),
          ilike(users.fullName, `%${keyword}%`),
          ilike(users.email, `%${keyword}%`),
        )
      : undefined,
    params.scope === 'personal' ? isNull(devices.workspaceId) : undefined,
    params.scope === 'workspace' ? isNotNull(devices.workspaceId) : undefined,
    params.workspaceId ? eq(devices.workspaceId, params.workspaceId) : undefined,
    // Personal rows carry the column default ('private') in storage but no
    // visibility dimension in the API, so a visibility filter must narrow to
    // workspace enrollments only.
    params.visibility
      ? and(isNotNull(devices.workspaceId), eq(devices.visibility, params.visibility))
      : undefined,
    params.platform ? eq(devices.platform, params.platform) : undefined,
  ].filter(Boolean);

  return conditions.length > 0 ? and(...conditions) : undefined;
};

const conflict = (message: string, cause?: unknown) =>
  new TRPCError({ code: 'CONFLICT', message, cause });

const forbidden = (message: string) => new TRPCError({ code: 'FORBIDDEN', message });

/**
 * Read-side shape normalization for `config.labs` (CUST-009).
 *
 * Only the stored shape is repaired here; whether a flag key is a real lab is
 * the caller's business, so upstream additions survive a read. A missing or
 * malformed config answers the upstream default (`user` mode, no flags), which
 * keeps a fresh install behaving exactly as before.
 */
const normalizeStoredLabsConfig = (
  stored: AdminConsoleLabsConfig | undefined,
): AdminConsoleLabsConfig => {
  const flags: Record<string, boolean> = {};

  if (stored?.flags && typeof stored.flags === 'object') {
    for (const [key, enabled] of Object.entries(stored.flags)) {
      if (typeof enabled === 'boolean') flags[key] = enabled;
    }
  }

  return { flags, mode: stored?.mode === 'admin' ? 'admin' : 'user' };
};

/**
 * Settings-singleton data access (CUST-008 P1/P2).
 *
 * The console owns exactly one row (`id = 'singleton'`). P1 kept these methods
 * on `AdminConsoleModel`; P2 extracts them so the model service depends on the
 * settings surface alone. Every write merges only the caller's slice, so the
 * model-service config and the bootstrap record never overwrite each other.
 */
export class AdminConsoleSettingsModel {
  protected db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  // ── settings ──────────────────────────────────────────────────────────

  getSettings = async (): Promise<AdminConsoleSettingsItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(adminConsoleSettings)
      .where(eq(adminConsoleSettings.id, ADMIN_CONSOLE_SETTINGS_ID))
      .limit(1);

    return row;
  };

  /**
   * Merge into the single settings row. Callers pass only their own slice so
   * P2's model-service config and the bootstrap record never overwrite each
   * other.
   */
  updateSettings = async (
    patch: Partial<AdminConsoleSettingsConfig>,
    updatedBy: string,
  ): Promise<AdminConsoleSettingsItem> => {
    return this.writeSettings(patch, updatedBy);
  };

  /**
   * Settings write with an optional optimistic lock.
   *
   * `expectedUpdatedAt` is the row version the admin read. The advisory lock
   * serializes writers (PGlite included), so a stale version means another
   * admin saved first and the caller must reload instead of overwriting it.
   */
  updateSettingsConfig = async (
    patch: Partial<AdminConsoleSettingsConfig>,
    updatedBy: string,
    expectedUpdatedAt?: Date,
  ): Promise<AdminConsoleSettingsItem> => {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('admin_console:settings'))`);

      if (expectedUpdatedAt) {
        const [current] = await tx
          .select({ updatedAt: adminConsoleSettings.updatedAt })
          .from(adminConsoleSettings)
          .where(eq(adminConsoleSettings.id, ADMIN_CONSOLE_SETTINGS_ID))
          .limit(1);

        if (!current || current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw conflict('CONFIG_CONFLICT');
        }
      }

      return this.writeSettings(patch, updatedBy, tx);
    });
  };

  // ── Labs (CUST-009) ───────────────────────────────────────────────────

  /**
   * The deployment's Unified Labs switch (`config.labs`), zero-migration.
   *
   * `config` is shape-normalized (see `normalizeStoredLabsConfig`); the row
   * version is returned so a caller can hand it back for optimistic locking.
   */
  getLabsConfig = async (): Promise<{
    config: AdminConsoleLabsConfig;
    updatedAt: Date | null;
    updatedBy: string | null;
  }> => {
    const row = await this.getSettings();

    return {
      config: normalizeStoredLabsConfig(row?.config?.labs),
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  };

  /**
   * Replace the Labs slice only.
   *
   * `config.ai` and `config.bootstrap` belong to other callers and must survive
   * a Labs save, so this reuses the settings advisory lock and the
   * `expectedUpdatedAt` optimistic lock instead of writing the row wholesale.
   */
  updateLabsConfig = async (
    next: AdminConsoleLabsConfig,
    options: { expectedUpdatedAt?: Date; updatedBy: string },
  ): Promise<AdminConsoleSettingsItem> => {
    return this.updateSettingsConfig({ labs: next }, options.updatedBy, options.expectedUpdatedAt);
  };

  private writeSettings = async (
    patch: Partial<AdminConsoleSettingsConfig>,
    updatedBy: string,
    executor: LobeChatDatabase | Transaction = this.db,
  ): Promise<AdminConsoleSettingsItem> => {
    const [row] = await executor
      .insert(adminConsoleSettings)
      .values({ config: patch, id: ADMIN_CONSOLE_SETTINGS_ID, updatedBy })
      .onConflictDoUpdate({
        set: {
          config: sql`${adminConsoleSettings.config} || ${JSON.stringify(patch)}::jsonb`,
          updatedAt: new Date(),
          updatedBy,
        },
        target: adminConsoleSettings.id,
      })
      .returning();

    return row;
  };
}

/**
 * Data access for the admin console (CUST-008 P1).
 *
 * The console is the only writer of account state: it reuses Better Auth's
 * `role` / `banned` / `banReason` / `banExpires` columns and never adds an
 * upstream column. Every destructive path serializes on one advisory lock and
 * re-checks that at least one enabled admin remains.
 */
export class AdminConsoleModel extends AdminConsoleSettingsModel {
  private actingUserId: string;

  constructor(db: LobeChatDatabase, actingUserId: string) {
    super(db);
    this.actingUserId = actingUserId;
  }

  // ── bootstrap ─────────────────────────────────────────────────────────

  getRole = async (userId: string): Promise<AdminRole | undefined> => {
    const [row] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return row ? normalizeAdminRole(row.role) : undefined;
  };

  /** Minimal identity used by the env allow-list check, without exposing the row. */
  getBootstrapIdentity = async (userId: string) => {
    const [row] = await this.db
      .select({
        email: users.email,
        id: users.id,
        role: users.role,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return row;
  };

  countActiveAdmins = async (): Promise<number> => {
    const [row] = await this.db.select({ value: count() }).from(users).where(isActiveAdmin());
    return row?.value ?? 0;
  };

  /** Lazy promotion from `ADMIN_CONSOLE_BOOTSTRAP_*`; only ever upgrades. */
  promoteToAdmin = async (userId: string, recordBootstrap: boolean): Promise<void> => {
    await this.db.transaction(async (tx) => {
      await this.lockLastAdmin(tx);
      await tx.update(users).set({ role: 'admin' }).where(eq(users.id, userId));
      if (recordBootstrap) {
        const at = new Date().toISOString();
        await tx
          .insert(adminConsoleSettings)
          .values({
            config: { bootstrap: { at, userId } },
            id: ADMIN_CONSOLE_SETTINGS_ID,
            updatedBy: userId,
          })
          .onConflictDoUpdate({
            set: {
              config: sql`${adminConsoleSettings.config} || ${JSON.stringify({
                bootstrap: { at, userId },
              })}::jsonb`,
              updatedAt: new Date(),
              updatedBy: userId,
            },
            target: adminConsoleSettings.id,
          });
      }
    });
  };

  // ── users ─────────────────────────────────────────────────────────────

  listUsers = async (params: AdminUserListParams = {}): Promise<AdminUserListResult> => {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const keyword = params.q?.trim();

    const conditions = [
      keyword
        ? or(
            ilike(users.email, `%${keyword}%`),
            ilike(users.username, `%${keyword}%`),
            ilike(users.fullName, `%${keyword}%`),
            ilike(users.firstName, `%${keyword}%`),
            ilike(users.lastName, `%${keyword}%`),
          )
        : undefined,
      params.role === 'admin' ? eq(users.role, 'admin') : undefined,
      params.role === 'user' ? or(isNull(users.role), ne(users.role, 'admin')) : undefined,
      params.status === 'banned' ? eq(users.banned, true) : undefined,
      params.status === 'active' ? notBanned() : undefined,
    ].filter(Boolean);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow, rows] = await Promise.all([
      this.db.select({ value: count() }).from(users).where(where),
      this.db
        .select({
          avatar: users.avatar,
          banned: users.banned,
          createdAt: users.createdAt,
          email: users.email,
          firstName: users.firstName,
          fullName: users.fullName,
          id: users.id,
          lastActiveAt: users.lastActiveAt,
          lastName: users.lastName,
          role: users.role,
          username: users.username,
        })
        .from(users)
        .where(where)
        .orderBy(asc(users.username))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    return {
      items: rows.map(toSummary),
      page,
      pageSize,
      total: totalRow[0]?.value ?? 0,
    };
  };

  getUser = async (userId: string): Promise<AdminUserDetail | undefined> => {
    const [row] = await this.db
      .select({
        avatar: users.avatar,
        banExpires: users.banExpires,
        banReason: users.banReason,
        banned: users.banned,
        createdAt: users.createdAt,
        email: users.email,
        emailVerified: users.emailVerified,
        firstName: users.firstName,
        fullName: users.fullName,
        id: users.id,
        lastActiveAt: users.lastActiveAt,
        lastName: users.lastName,
        role: users.role,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) return;

    return {
      ...toSummary(row),
      banExpires: row.banExpires,
      banReason: row.banReason,
      emailVerified: row.emailVerified === true,
    };
  };

  setRole = async (userId: string, role: AdminRole) => {
    if (userId === this.actingUserId) {
      throw conflict('SELF_LOCKOUT');
    }

    await this.db.transaction(async (tx) => {
      await this.lockLastAdmin(tx);
      const target = await this.loadTarget(tx, userId);

      if (role === 'user' && normalizeAdminRole(target.role) === 'admin' && !target.banned) {
        const others = await this.countOtherActiveAdmins(tx, userId);
        if (others === 0) throw conflict('LAST_ADMIN');
      }

      await tx.update(users).set({ role }).where(eq(users.id, userId));
    });

    return this.getUser(userId);
  };

  banUser = async (userId: string, reason: string, expiresAt?: Date) => {
    if (userId === this.actingUserId) {
      throw conflict('SELF_LOCKOUT');
    }

    await this.db.transaction(async (tx) => {
      await this.lockLastAdmin(tx);
      const target = await this.loadTarget(tx, userId);

      if (normalizeAdminRole(target.role) === 'admin' && !target.banned) {
        const others = await this.countOtherActiveAdmins(tx, userId);
        if (others === 0) throw conflict('LAST_ADMIN');
      }

      // ① API keys first: `validateApiKey` does not read `users.banned`, so a
      // live key would otherwise keep authenticating a banned account.
      await tx.update(apiKeys).set({ enabled: false }).where(eq(apiKeys.userId, userId));
      // ② Account state.
      await tx
        .update(users)
        .set({ banExpires: expiresAt ?? null, banReason: reason, banned: true })
        .where(eq(users.id, userId));
    });

    // ③ Best effort: an active session is not a security boundary we must win
    // against, and a session-store hiccup must not roll back the ban.
    const revokedSessions = await this.tryRevokeSessions(userId);

    return { ...(await this.getUser(userId)), revokedSessions };
  };

  unbanUser = async (userId: string) => {
    const updated = await this.db
      .update(users)
      .set({ banExpires: null, banReason: null, banned: false })
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    if (updated.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'USER_NOT_FOUND' });

    return this.getUser(userId);
  };

  revokeSessions = async (userId: string): Promise<number> => {
    const removed = await this.db
      .delete(session)
      .where(eq(session.userId, userId))
      .returning({ id: session.id });

    return removed.length;
  };

  /**
   * Permanently delete a normal account (CUST-008 P1, user deletion).
   *
   * Rules:
   * - the acting admin can never delete themselves (`SELF_LOCKOUT`);
   * - an account with the `admin` role is never deletable (`ADMIN_PROTECTED`),
   *   banned or not — demote it first, which already enforces the last-admin
   *   invariant;
   * - every row that belongs to the account goes with it. `UserModel.deleteUser`
   *   owns that cascade (users FK cascade plus the tables it must handle
   *   explicitly, e.g. share-visitor topics and personal channels), and the
   *   guards re-run inside its transaction under the row lock, so a concurrent
   *   promotion cannot turn this into an admin delete.
   *
   * No tombstone is written: the email / SSO subject is free again, so the
   * person can register or sign in through SSO and get a brand-new account.
   */
  deleteUser = async (userId: string): Promise<{ id: string }> => {
    if (userId === this.actingUserId) throw conflict('SELF_LOCKOUT');

    try {
      await UserModel.deleteUser(this.db, userId, {
        assertDeletable: async (tx) => {
          await this.lockLastAdmin(tx);
          const target = await this.loadTarget(tx, userId);
          if (normalizeAdminRole(target.role) === 'admin') throw conflict('ADMIN_PROTECTED');
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === AGENT_TRANSFER_PENDING_OWNER_DELETE) {
        throw conflict('AGENT_TRANSFER_PENDING', error);
      }
      throw error;
    }

    return { id: userId };
  };

  // ── devices (CUST-010, read-only cross-user inventory) ────────────────

  /**
   * Every registered device in the deployment, any owner, any workspace.
   *
   * Deliberately unscoped: the admin view is machine inventory, so it includes
   * other members' `private` workspace rows. The projection stops at
   * `adminDeviceSelection` (no cwd fields, no raw metadata).
   *
   * `onlineStats` is a placeholder — presence belongs to the gateway probe the
   * interface layer runs after this query, so the model cannot tally it.
   */
  listDevices = async (params: AdminDeviceListParams = {}): Promise<AdminDeviceListResult> => {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(ADMIN_DEVICE_MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));
    const where = adminDeviceWhere(params);

    const [totalRow, rows] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(devices)
        .leftJoin(users, eq(users.id, devices.userId))
        .leftJoin(workspaces, eq(workspaces.id, devices.workspaceId))
        .where(where),
      this.db
        .select(adminDeviceSelection)
        .from(devices)
        .leftJoin(users, eq(users.id, devices.userId))
        .leftJoin(workspaces, eq(workspaces.id, devices.workspaceId))
        .where(where)
        // `last_seen_at` has no index; MVP data volume tolerates the sort (see
        // CUST-010 delivery notes). The tiebreaker keeps paging deterministic.
        .orderBy(desc(devices.lastSeenAt), asc(devices.deviceId))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    return {
      items: rows.map(toAdminDeviceSummary),
      onlineStats: { offline: 0, online: 0, unknown: 0 },
      page,
      pageSize,
      total: totalRow[0]?.value ?? 0,
    };
  };

  /**
   * One device, addressed by the same pair that identifies its row.
   *
   * A device row's identity is `(workspaceId, deviceId)` for workspace
   * enrollments and `(userId, deviceId)` for personal ones — that is exactly
   * what the partial unique indexes in `schemas/device.ts` enforce. The
   * `deviceId` hash normally mixes in the principal, but `lh connect
   * --device-id` pins an explicit id and produces the same `deviceId` for two
   * owners, so a personal row cannot be addressed by `deviceId` alone.
   *
   * `ownerId` disambiguates the personal pool. Omitting it keeps the legacy
   * "any owner" lookup for unique ids, but an ambiguous id resolves to
   * `undefined` rather than an arbitrary row: showing one administrator the
   * other owner's machine is the one failure mode this must never have.
   *
   * `channels` is empty here: connections are gateway state. `managedPhase`
   * likewise lives in the managed-device provider and is filled upstream.
   */
  getDevice = async (
    deviceId: string,
    scope: { ownerId?: string; workspaceId: string | null },
  ): Promise<AdminDeviceDetail | undefined> => {
    const rows = await this.db
      .select({
        ...adminDeviceSelection,
        // Only the two whitelisted metadata keys leave the database.
        appVersion: sql<string | null>`${devices.metadata} ->> 'appVersion'`,
        cliVersion: sql<string | null>`${devices.metadata} ->> 'cliVersion'`,
      })
      .from(devices)
      .leftJoin(users, eq(users.id, devices.userId))
      .leftJoin(workspaces, eq(workspaces.id, devices.workspaceId))
      .where(
        and(
          eq(devices.deviceId, deviceId),
          scope.workspaceId
            ? eq(devices.workspaceId, scope.workspaceId)
            : and(
                isNull(devices.workspaceId),
                scope.ownerId ? eq(devices.userId, scope.ownerId) : undefined,
              ),
        ),
      )
      // Two rows means the address is ambiguous; the caller asked for one
      // machine, and picking either would be a wrong answer.
      .limit(2);

    if (rows.length !== 1) return;
    const [row] = rows;

    return {
      ...toAdminDeviceSummary(row),
      appVersion: row.appVersion ?? undefined,
      channels: [],
      cliVersion: row.cliVersion ?? undefined,
      hasFixedAgentBinding: scope.workspaceId
        ? await this.hasFixedAgentBinding(scope.workspaceId, deviceId)
        : false,
    };
  };

  /**
   * Header counters for the overview page, independent of the list filter.
   *
   * Two aggregate queries plus one distinct count, no per-row round-trips.
   */
  getDeviceStats = async (): Promise<AdminDeviceStats> => {
    const [totals, platformRows, workspaceRow] = await Promise.all([
      this.db
        .select({
          activeLast7d: sql<number>`count(*) filter (where ${devices.lastSeenAt} >= now() - interval '7 days')`,
          personal: sql<number>`count(*) filter (where ${devices.workspaceId} is null)`,
          total: count(),
          workspace: sql<number>`count(*) filter (where ${devices.workspaceId} is not null)`,
        })
        .from(devices),
      this.db
        .select({ platform: devices.platform, value: count() })
        .from(devices)
        .groupBy(devices.platform),
      this.db.select({ value: sql<number>`count(distinct ${devices.workspaceId})` }).from(devices),
    ]);

    const byPlatform: Record<string, number> = {};
    for (const row of platformRows) {
      byPlatform[row.platform ?? 'unknown'] = Number(row.value);
    }

    const row = totals[0];

    return {
      activeLast7d: Number(row?.activeLast7d ?? 0),
      byPlatform,
      personal: Number(row?.personal ?? 0),
      total: Number(row?.total ?? 0),
      workspace: Number(row?.workspace ?? 0),
      workspaceCount: Number(workspaceRow[0]?.value ?? 0),
    };
  };

  // ── Workspaces (admin console) ────────────────────────────────────────

  /**
   * Every workspace in the deployment, with the two counters the console shows.
   * Counters are correlated subqueries rather than a GROUP BY: a workspace with
   * no members or no devices must still appear with zeros.
   */
  listWorkspaces = async (
    params: { page?: number; pageSize?: number; q?: string } = {},
  ): Promise<AdminWorkspaceListResult> => {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 20));
    const q = params.q?.trim();
    const where = q
      ? or(ilike(workspaces.name, `%${q}%`), ilike(workspaces.slug, `%${q}%`))
      : undefined;

    const [totalRow, rows] = await Promise.all([
      this.db.select({ value: count() }).from(workspaces).where(where),
      this.db
        .select({
          createdAt: workspaces.createdAt,
          deviceCount: sql<number>`(
            select count(*) from ${devices} d where d.workspace_id = ${workspaces.id}
          )`,
          id: workspaces.id,
          memberCount: sql<number>`(
            select count(*) from ${workspaceMembers} wm
            where wm.workspace_id = ${workspaces.id} and wm.deleted_at is null
          )`,
          name: workspaces.name,
          ownerEmail: users.email,
          ownerId: workspaces.primaryOwnerId,
          ownerUsername: users.username,
          slug: workspaces.slug,
        })
        .from(workspaces)
        .leftJoin(users, eq(users.id, workspaces.primaryOwnerId))
        .where(where)
        .orderBy(desc(workspaces.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    return {
      items: rows.map((row) => ({
        createdAt: row.createdAt,
        deviceCount: Number(row.deviceCount ?? 0),
        id: row.id,
        memberCount: Number(row.memberCount ?? 0),
        name: row.name,
        ownerEmail: row.ownerEmail,
        ownerId: row.ownerId,
        ownerUsername: row.ownerUsername,
        slug: row.slug,
      })),
      page,
      pageSize,
      total: totalRow[0]?.value ?? 0,
    };
  };

  /** Active members of one workspace, newest join last. */
  listWorkspaceMembers = async (workspaceId: string): Promise<AdminWorkspaceMember[]> => {
    const rows = await this.db
      .select({
        email: users.email,
        fullName: users.fullName,
        joinedAt: workspaceMembers.joinedAt,
        role: workspaceMembers.role,
        userId: workspaceMembers.userId,
        username: users.username,
      })
      .from(workspaceMembers)
      .leftJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), isNull(workspaceMembers.deletedAt)))
      .orderBy(asc(workspaceMembers.joinedAt));

    return rows.map((row) => ({
      email: row.email,
      fullName: row.fullName,
      joinedAt: row.joinedAt,
      role: (row.role ?? 'member') as AdminWorkspaceMember['role'],
      userId: row.userId,
      username: row.username,
    }));
  };

  /** Resolve a member picker's email / username to a real account. */
  findUserByIdentity = async (identity: string) => {
    const [row] = await this.db
      .select({ email: users.email, id: users.id, username: users.username })
      .from(users)
      .where(or(eq(users.email, identity), eq(users.username, identity)))
      .limit(1);
    return row;
  };

  // ── helpers ───────────────────────────────────────────────────────────

  private lockLastAdmin = async (tx: Transaction) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('admin_console:last_admin'))`);
  };

  /**
   * Whether a workspace device is the enforced target of any fixed agent.
   *
   * Same reference guard as `DeviceModel.hasFixedAgentBinding`, but addressed
   * by an explicit workspace because the console has no acting workspace, and
   * reduced to a boolean so the console is never handed a binding id.
   */
  private hasFixedAgentBinding = async (workspaceId: string, deviceId: string) => {
    const [row] = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.workspaceId, workspaceId),
          sql`${agents.agencyConfig}->>'executionTargetSelectionPolicy' = 'fixed'`,
          sql`${agents.agencyConfig}->>'executionTarget' = 'device'`,
          sql`${agents.agencyConfig}->>'boundDeviceId' = ${deviceId}`,
        ),
      )
      .limit(1);

    return !!row;
  };

  private loadTarget = async (tx: Transaction, userId: string) => {
    const [target] = await tx
      .select({ banned: users.banned, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'USER_NOT_FOUND' });

    return { banned: target.banned === true, role: target.role };
  };

  private countOtherActiveAdmins = async (tx: Transaction, userId: string) => {
    const [row] = await tx
      .select({ value: count() })
      .from(users)
      .where(and(isActiveAdmin(), ne(users.id, userId)));

    return row?.value ?? 0;
  };

  /** Sessions are a cache of login state; failing to clear them must not fail a ban. */
  private tryRevokeSessions = async (userId: string): Promise<number> => {
    try {
      return await this.revokeSessions(userId);
    } catch (error) {
      console.error('Failed to revoke sessions for banned user:', error);
      return 0;
    }
  };
}

/** Marker used by procedures that must answer 403 rather than leak existence. */
export const adminRequiredError = () => forbidden('ADMIN_REQUIRED');
