import {
  AdminConsoleModel,
  AdminConsoleSettingsModel,
  type LobeChatDatabase,
} from '@lobechat/database';
import type {
  AdminConsoleLabsConfig,
  AdminConsoleLabsConfigUpdate,
  AdminConsoleLabsConfigView,
  UserLab,
  UserPreference,
} from '@lobechat/types';
import { ADMIN_CONSOLE_ERROR } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import {
  applyLabOverrides,
  invalidateLabOverrides,
  isKnownLabFlag,
  resolveLabGate,
  resolveLabOverrides,
  sanitizeLabFlags,
} from '../labs/resolver';

/**
 * Unified Labs switch (CUST-009): storage and admin write.
 *
 * The deployment's lab flags live in the admin console's settings row
 * (`admin_console_settings.config.labs`) and are applied at READ time by
 * `labs/resolver.ts`. This module keeps the write path (validation, optimistic
 * locking, cache invalidation) and re-exports thin wrappers so existing
 * consumers keep their import path; the resolution semantics themselves exist
 * exactly once, in the resolver:
 *
 *   effectiveLab = mode === 'admin'
 *     ? { ...DEFAULT_PREFERENCE.lab, ...flags }   // unset = off, no fallback
 *     : user.preference.lab                        // upstream behaviour
 */

/** Bounds a malformed payload; the real list is far below this. */
const MAX_LAB_FLAGS = 200;

const invalidConfig = () =>
  new TRPCError({ code: 'BAD_REQUEST', message: ADMIN_CONSOLE_ERROR.invalidLabsConfig });

/** Read-side normalization: unknown keys / non-booleans are dropped, never thrown. */
export const normalizeLabsConfig = (raw: unknown): AdminConsoleLabsConfig => {
  if (!raw || typeof raw !== 'object') return { flags: {}, mode: 'user' };

  const value = raw as Partial<AdminConsoleLabsConfig>;

  return {
    // Storage repairs the shape; the resolver drops keys this build no longer knows.
    flags: sanitizeLabFlags(value.flags),
    mode: value.mode === 'admin' ? 'admin' : 'user',
  };
};

const validateFlags = (flags: Record<string, boolean>): Record<string, boolean> => {
  const entries = Object.entries(flags);
  if (entries.length > MAX_LAB_FLAGS) throw invalidConfig();

  const next: Record<string, boolean> = {};
  for (const [key, enabled] of entries) {
    // Admin writes are validated against the upstream lab schema: a typo fails
    // loudly instead of silently doing nothing, and a new upstream flag is
    // accepted as soon as the schema has it.
    if (typeof enabled !== 'boolean' || !isKnownLabFlag(key)) throw invalidConfig();
    next[key] = enabled;
  }

  return next;
};

/**
 * Resolve one user's lab flags against the deployment config.
 *
 * Kept as a named wrapper for existing callers; the rule lives in
 * `applyLabOverrides`.
 */
export const resolveEffectiveLab = (
  config: AdminConsoleLabsConfig,
  userLab: UserLab | null | undefined,
): UserLab | undefined => applyLabOverrides(userLab, config);

/** Admin-page read: uncached, so the page always paints what the server stored. */
export const readAdminLabsConfig = async (
  db: LobeChatDatabase,
): Promise<AdminConsoleLabsConfigView> => {
  const { config, updatedAt, updatedBy } = await new AdminConsoleSettingsModel(db).getLabsConfig();

  return {
    ...normalizeLabsConfig(config),
    updatedAt: updatedAt?.toISOString() ?? null,
    updatedBy,
  };
};

/** Drop the cached config after a write (and in tests); delegates to the resolver cache. */
export const invalidateAdminLabsCache = (db?: LobeChatDatabase) => {
  invalidateLabOverrides(db);
};

/** Hot-path read used by the gates; the same 5s process cache as the user bootstrap. */
export const resolveAdminLabsConfig = async (
  db: LobeChatDatabase,
): Promise<AdminConsoleLabsConfig> => resolveLabOverrides(db);

/**
 * The read-time override for one loaded preference row.
 *
 * Returns the user's own lab in `user` mode (untouched), and the deployment
 * flags in `admin` mode. Read failures fall back to `user` mode.
 */
export const resolveEffectiveLabForPreference = async (
  db: LobeChatDatabase,
  preference: Pick<UserPreference, 'lab'> | null | undefined,
): Promise<UserLab | undefined> =>
  applyLabOverrides(preference?.lab, await resolveLabOverrides(db));

/** What `getUserState` should hand the client for the Labs surfaces (CUST-009). */
export interface UserStateLabs {
  /** Only meaningful in `admin` mode; `undefined` keeps the client's own guard. */
  isAdmin?: boolean;
  /** The effective lab: deployment flags in admin mode, the stored row otherwise. */
  lab?: UserLab;
  labsMode: 'admin' | 'user';
}

/**
 * Resolves the Labs fields `getUserState` returns.
 *
 * Use when:
 * - Building the user bootstrap payload; the client then reads only
 *   `preference.lab` and needs no second Labs list.
 * Expects:
 * - `userLab` is the stored `users.preference.lab`, untouched in `user` mode.
 * Returns:
 * - The effective lab plus who owns it. In `admin` mode the role decides
 *   whether the per-user Labs page stays reachable for this caller.
 *
 * A failed settings read already degrades to `user` mode inside the resolver,
 * and a failed role read only loses the page (never the login), so a broken
 * read can never block sign-in.
 */
export const resolveLabsForUserState = async (
  db: LobeChatDatabase,
  userId: string,
  userLab: UserLab | null | undefined,
): Promise<UserStateLabs> => {
  const config = await resolveLabOverrides(db);
  if (config.mode !== 'admin') return { lab: userLab ?? undefined, labsMode: 'user' };

  let isAdmin = false;
  try {
    isAdmin = (await new AdminConsoleModel(db, userId).getRole(userId)) === 'admin';
  } catch (error) {
    console.error('[Labs] Failed to read the caller role for the Labs page:', error);
  }

  return { isAdmin, lab: applyLabOverrides(userLab, config), labsMode: 'admin' };
};

/**
 * `enableSelfLearning` as the background scheduler must see it:
 * `undefined` = per-user SQL filter (upstream), `true` / `false` = deployment-wide.
 */
export const resolveSelfLearningGate = async (db: LobeChatDatabase): Promise<boolean | undefined> =>
  resolveLabGate(db, 'enableSelfLearning');

/** Admin write; `flags` replaces the stored map, omitted keeps it. */
export const updateAdminLabsConfig = async (
  db: LobeChatDatabase,
  input: AdminConsoleLabsConfigUpdate,
  updatedBy: string,
): Promise<AdminConsoleLabsConfigView> => {
  if (input.mode !== 'user' && input.mode !== 'admin') throw invalidConfig();

  const current = await readAdminLabsConfig(db);
  const next: AdminConsoleLabsConfig = {
    flags: input.flags ? validateFlags(input.flags) : current.flags,
    mode: input.mode,
  };

  const row = await new AdminConsoleSettingsModel(db).updateLabsConfig(next, {
    expectedUpdatedAt: input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : undefined,
    updatedBy,
  });

  invalidateAdminLabsCache(db);

  return {
    ...next,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
};
