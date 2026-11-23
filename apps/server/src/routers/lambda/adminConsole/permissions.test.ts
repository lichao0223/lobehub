// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  adminProcedure,
  getBootstrapAllowList,
  isAdminRole,
  resolveAdminState,
} from '@/business/server/adminConsole/permissions';
import { getTestDB } from '@/database/core/getTestDB';
import { adminConsoleSettings, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { createCallerFactory, router } from '@/libs/trpc/lambda';

import { adminConsoleRouter } from './index';

const mocks = vi.hoisted(() => ({ getServerDB: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));

const serverDB: LobeChatDatabase = await getTestDB();
mocks.getServerDB.mockResolvedValue(serverDB);

const ids = {
  configured: 'admin-bootstrap-configured',
  existingAdmin: 'admin-bootstrap-existing-admin',
  other: 'admin-bootstrap-other',
};

const cleanup = async () => {
  await serverDB.delete(adminConsoleSettings).where(eq(adminConsoleSettings.id, 'singleton'));
  await serverDB.delete(users).where(inArray(users.id, Object.values(ids)));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([
    { email: 'boss@tellhowsoft.com', id: ids.configured, role: 'user', username: 'EMP-001' },
    { email: 'existing@tellhowsoft.com', id: ids.existingAdmin, role: 'admin' },
    { email: 'other@example.com', id: ids.other, role: 'user' },
  ]);
});

afterEach(cleanup);

describe('isAdminRole', () => {
  it.each([
    ['admin', true],
    ['user', false],
    [null, false],
    [undefined, false],
    ['', false],
    ['ADMIN', false],
  ])('%s → %s', (role, expected) => {
    expect(isAdminRole(role as string | null | undefined)).toBe(expected);
  });
});

describe('getBootstrapAllowList', () => {
  it('is unconfigured when both lists are empty', () => {
    expect(getBootstrapAllowList({})).toMatchObject({ configured: false });
    expect(getBootstrapAllowList({ ADMIN_CONSOLE_BOOTSTRAP_EMAILS: ' , ' }).configured).toBe(false);
  });

  it('normalizes comma-separated identities and user ids', () => {
    const list = getBootstrapAllowList({
      ADMIN_CONSOLE_BOOTSTRAP_EMAILS: ' Admin@TellhowSoft.com , ops@tellhowsoft.com ',
      ADMIN_CONSOLE_BOOTSTRAP_USER_IDS: 'USER-1, user-2',
    });

    expect(list.configured).toBe(true);
    expect([...list.identities].sort()).toEqual(['admin@tellhowsoft.com', 'ops@tellhowsoft.com']);
    expect([...list.userIds].sort()).toEqual(['user-1', 'user-2']);
  });
});

describe('resolveAdminState bootstrap', () => {
  it('does nothing when no allow-list is configured', async () => {
    const state = await resolveAdminState(serverDB, ids.configured, {});

    expect(state).toEqual({
      bootstrapConfigured: false,
      canBootstrap: false,
      isAdmin: false,
      role: 'user',
    });
  });

  it('promotes a matching email on first visit and records the bootstrap', async () => {
    const state = await resolveAdminState(serverDB, ids.configured, {
      ADMIN_CONSOLE_BOOTSTRAP_EMAILS: 'boss@tellhowsoft.com',
    });

    expect(state).toMatchObject({ canBootstrap: false, isAdmin: true, role: 'admin' });

    const [row] = await serverDB
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, ids.configured));
    expect(row.role).toBe('admin');

    const settings = await serverDB
      .select()
      .from(adminConsoleSettings)
      .where(eq(adminConsoleSettings.id, 'singleton'));
    expect(settings[0]?.config.bootstrap?.userId).toBe(ids.configured);
  });

  it('matches a username and keeps the promotion after the list is removed', async () => {
    await resolveAdminState(serverDB, ids.configured, {
      ADMIN_CONSOLE_BOOTSTRAP_EMAILS: 'EMP-001',
    });

    const afterRemoval = await resolveAdminState(serverDB, ids.configured, {});
    expect(afterRemoval.isAdmin).toBe(true);
  });

  it('matches a user id from ADMIN_CONSOLE_BOOTSTRAP_USER_IDS', async () => {
    const state = await resolveAdminState(serverDB, ids.configured, {
      ADMIN_CONSOLE_BOOTSTRAP_USER_IDS: ids.configured,
    });

    expect(state.isAdmin).toBe(true);
  });

  it('stops bootstrap once an admin and a bootstrap record exist', async () => {
    // The configured account is not eligible while another admin exists and a
    // bootstrap has already happened.
    await serverDB.insert(adminConsoleSettings).values({
      config: { bootstrap: { at: new Date().toISOString(), userId: ids.existingAdmin } },
      id: 'singleton',
      updatedBy: ids.existingAdmin,
    });

    const state = await resolveAdminState(serverDB, ids.configured, {
      ADMIN_CONSOLE_BOOTSTRAP_EMAILS: 'boss@tellhowsoft.com',
    });

    expect(state).toMatchObject({ bootstrapConfigured: true, canBootstrap: false, isAdmin: false });
  });

  it('bootstraps again when no enabled admin remains', async () => {
    await serverDB.insert(adminConsoleSettings).values({
      config: { bootstrap: { at: new Date().toISOString(), userId: ids.existingAdmin } },
      id: 'singleton',
      updatedBy: ids.existingAdmin,
    });
    await serverDB.update(users).set({ banned: true }).where(eq(users.id, ids.existingAdmin));

    const state = await resolveAdminState(serverDB, ids.configured, {
      ADMIN_CONSOLE_BOOTSTRAP_EMAILS: 'boss@tellhowsoft.com',
    });

    expect(state).toMatchObject({ isAdmin: true, role: 'admin' });
  });

  it('does not promote an account outside the list', async () => {
    const state = await resolveAdminState(serverDB, ids.other, {
      ADMIN_CONSOLE_BOOTSTRAP_EMAILS: 'boss@tellhowsoft.com',
    });

    expect(state.isAdmin).toBe(false);
  });
});

describe('adminProcedure', () => {
  const guardRouter = router({ guard: adminProcedure.query(() => 'ok') });
  const createGuardCaller = createCallerFactory(guardRouter);
  const guardCallerFor = (userId?: string) => createGuardCaller({ userId } as never);

  it('keeps an anonymous call a 401', async () => {
    await expect(guardCallerFor().guard()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('answers a normal user with ADMIN_REQUIRED', async () => {
    await expect(guardCallerFor(ids.other).guard()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'ADMIN_REQUIRED',
    });
  });

  it('lets an admin through', async () => {
    await expect(guardCallerFor(ids.existingAdmin).guard()).resolves.toBe('ok');
  });

  it('lazily bootstraps a listed account and lets it through', async () => {
    const previous = process.env.ADMIN_CONSOLE_BOOTSTRAP_EMAILS;
    process.env.ADMIN_CONSOLE_BOOTSTRAP_EMAILS = 'boss@tellhowsoft.com';

    try {
      await expect(guardCallerFor(ids.configured).guard()).resolves.toBe('ok');

      const [row] = await serverDB
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, ids.configured));
      expect(row.role).toBe('admin');
    } finally {
      if (previous === undefined) delete process.env.ADMIN_CONSOLE_BOOTSTRAP_EMAILS;
      else process.env.ADMIN_CONSOLE_BOOTSTRAP_EMAILS = previous;
    }
  });
});

describe('adminConsole.whoami', () => {
  const whoamiCallerFor = (userId?: string) => adminConsoleRouter.createCaller({ userId } as never);

  it('rejects an anonymous call with 401', async () => {
    await expect(whoamiCallerFor().whoami()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('reports a normal user without promoting', async () => {
    await expect(whoamiCallerFor(ids.other).whoami()).resolves.toEqual({
      bootstrapConfigured: false,
      canBootstrap: false,
      isAdmin: false,
      role: 'user',
    });
  });

  it('reports an admin', async () => {
    await expect(whoamiCallerFor(ids.existingAdmin).whoami()).resolves.toMatchObject({
      isAdmin: true,
      role: 'admin',
    });
  });

  it('promotes a listed account on the first visit', async () => {
    const previous = process.env.ADMIN_CONSOLE_BOOTSTRAP_EMAILS;
    process.env.ADMIN_CONSOLE_BOOTSTRAP_EMAILS = 'boss@tellhowsoft.com';

    try {
      await expect(whoamiCallerFor(ids.configured).whoami()).resolves.toMatchObject({
        bootstrapConfigured: true,
        isAdmin: true,
        role: 'admin',
      });
    } finally {
      if (previous === undefined) delete process.env.ADMIN_CONSOLE_BOOTSTRAP_EMAILS;
      else process.env.ADMIN_CONSOLE_BOOTSTRAP_EMAILS = previous;
    }
  });
});
