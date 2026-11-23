import type {
  AdminConsoleSettingsConfig,
  AdminRole,
  AdminUserDetail,
  AdminUserListParams,
  AdminUserListResult,
  AdminUserSummary,
} from '@lobechat/types';
import { ADMIN_CONSOLE_SETTINGS_ID } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, asc, count, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';

import type { AdminConsoleSettingsItem } from '../schemas';
import { adminConsoleSettings, apiKeys, session, users } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

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

const conflict = (message: string, cause?: unknown) =>
  new TRPCError({ code: 'CONFLICT', message, cause });

const forbidden = (message: string) => new TRPCError({ code: 'FORBIDDEN', message });

/**
 * Data access for the admin console (CUST-008 P1).
 *
 * The console is the only writer of account state: it reuses Better Auth's
 * `role` / `banned` / `banReason` / `banExpires` columns and never adds an
 * upstream column. Every destructive path serializes on one advisory lock and
 * re-checks that at least one enabled admin remains.
 */
export class AdminConsoleModel {
  private db: LobeChatDatabase;
  private actingUserId: string;

  constructor(db: LobeChatDatabase, actingUserId: string) {
    this.db = db;
    this.actingUserId = actingUserId;
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
    const [row] = await this.db
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

  // ── helpers ───────────────────────────────────────────────────────────

  private lockLastAdmin = async (tx: Transaction) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('admin_console:last_admin'))`);
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
