import { AdminConsoleModel, type LobeChatDatabase } from '@lobechat/database';
import type { AdminWhoamiResult } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { authedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

/**
 * Admin console identity (CUST-008 §12).
 *
 * `users.role` is the only source of truth; the console never adds an
 * `is_admin` column. Bootstrap is a lazy, additive promotion from an env
 * allow-list: it only runs when an admin endpoint / `whoami` is called, and it
 * never demotes anyone when the list changes.
 */

export const isAdminRole = (role: string | null | undefined): boolean => role === 'admin';

interface BootstrapAllowList {
  configured: boolean;
  /** Lower-cased emails and usernames. */
  identities: Set<string>;
  userIds: Set<string>;
}

const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

export const getBootstrapAllowList = (env: NodeJS.ProcessEnv = process.env): BootstrapAllowList => {
  // The email list also accepts usernames: both are login identities (§12.2 rule 2).
  const identities = new Set(splitList(env.ADMIN_CONSOLE_BOOTSTRAP_EMAILS));
  const userIds = new Set(splitList(env.ADMIN_CONSOLE_BOOTSTRAP_USER_IDS));

  return {
    configured: identities.size > 0 || userIds.size > 0,
    identities,
    userIds,
  };
};

interface BootstrapUser {
  email: string | null;
  id: string;
  role: string | null;
  username: string | null;
}

const matchesAllowList = (user: BootstrapUser, list: BootstrapAllowList): boolean => {
  if (list.userIds.has(user.id.toLowerCase())) return true;
  if (user.email && list.identities.has(user.email.toLowerCase())) return true;
  if (user.username && list.identities.has(user.username.toLowerCase())) return true;
  return false;
};

/**
 * Resolve the caller's admin state and, when eligible, promote lazily.
 *
 * Eligible means: the account matches the allow-list, it is not already admin,
 * and either the instance has no enabled admin or no bootstrap promotion was
 * ever recorded. The promotion itself is idempotent and only ever upgrades.
 */
export const resolveAdminState = async (
  db: LobeChatDatabase,
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminWhoamiResult> => {
  const list = getBootstrapAllowList(env);
  const model = new AdminConsoleModel(db, userId);

  const role = await model.getRole(userId);
  if (role === undefined) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'USER_NOT_FOUND' });
  }

  if (role === 'admin') {
    return { bootstrapConfigured: list.configured, canBootstrap: false, isAdmin: true, role };
  }

  if (!list.configured) {
    return { bootstrapConfigured: false, canBootstrap: false, isAdmin: false, role };
  }

  const user = await model.getBootstrapIdentity(userId);
  if (!user || !matchesAllowList(user, list)) {
    return { bootstrapConfigured: true, canBootstrap: false, isAdmin: false, role };
  }

  const [settings, activeAdmins] = await Promise.all([
    model.getSettings(),
    model.countActiveAdmins(),
  ]);
  const everBootstrapped = Boolean(settings?.config?.bootstrap);
  const canBootstrap = activeAdmins === 0 || !everBootstrapped;

  if (!canBootstrap) {
    return { bootstrapConfigured: true, canBootstrap: false, isAdmin: false, role };
  }

  await model.promoteToAdmin(userId, !everBootstrapped);

  return { bootstrapConfigured: true, canBootstrap: false, isAdmin: true, role: 'admin' };
};

/** Every admin endpoint runs this: 401 stays 401, a normal user gets `ADMIN_REQUIRED`. */
export const adminProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'UNAUTHORIZED' });
  }

  const state = await resolveAdminState(ctx.serverDB, ctx.userId);

  if (!state.isAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'ADMIN_REQUIRED' });
  }

  return next({
    ctx: {
      adminModel: new AdminConsoleModel(ctx.serverDB, ctx.userId),
      adminRole: 'admin' as const,
      adminUserId: ctx.userId,
    },
  });
});
