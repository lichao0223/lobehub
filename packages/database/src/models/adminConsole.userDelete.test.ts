// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { adminConsoleSettings, apiKeys, session, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { AdminConsoleModel } from './adminConsole';

const serverDB: LobeChatDatabase = await getTestDB();

const ids = {
  actor: 'admin-delete-actor',
  admin: 'admin-delete-admin',
  bannedAdmin: 'admin-delete-banned-admin',
  member: 'admin-delete-member',
};

const cleanup = async () => {
  await serverDB.delete(adminConsoleSettings).where(eq(adminConsoleSettings.id, 'singleton'));
  await serverDB.delete(session).where(inArray(session.userId, Object.values(ids)));
  await serverDB.delete(apiKeys).where(inArray(apiKeys.userId, Object.values(ids)));
  await serverDB.delete(users).where(inArray(users.id, Object.values(ids)));
};

const findUser = async (id: string) => {
  const [row] = await serverDB.select({ id: users.id }).from(users).where(eq(users.id, id));
  return row;
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([
    { email: 'actor@example.com', id: ids.actor, role: 'admin', username: 'D0001' },
    { email: 'admin@example.com', id: ids.admin, role: 'admin', username: 'D0002' },
    { banned: true, email: 'banned-admin@example.com', id: ids.bannedAdmin, role: 'admin' },
    {
      email: 'member@example.com',
      id: ids.member,
      normalizedEmail: 'member@example.com',
      role: 'user',
      username: 'D0004',
    },
  ]);
});

afterEach(cleanup);

describe('AdminConsoleModel.deleteUser', () => {
  it('refuses to delete the acting admin', async () => {
    await expect(
      new AdminConsoleModel(serverDB, ids.actor).deleteUser(ids.actor),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'SELF_LOCKOUT' });

    await expect(findUser(ids.actor)).resolves.toBeDefined();
  });

  it('refuses to delete an admin account, banned or not', async () => {
    const model = new AdminConsoleModel(serverDB, ids.actor);

    await expect(model.deleteUser(ids.admin)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'ADMIN_PROTECTED',
    });
    await expect(model.deleteUser(ids.bannedAdmin)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'ADMIN_PROTECTED',
    });

    await expect(findUser(ids.admin)).resolves.toBeDefined();
    await expect(findUser(ids.bannedAdmin)).resolves.toBeDefined();
  });

  it('reports USER_NOT_FOUND for an account that no longer exists', async () => {
    await expect(
      new AdminConsoleModel(serverDB, ids.actor).deleteUser('admin-delete-missing'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'USER_NOT_FOUND' });
  });

  it('physically removes a normal account and its sessions and API keys', async () => {
    await serverDB.insert(session).values({
      expiresAt: new Date(Date.now() + 60_000),
      id: 'admin-delete-session',
      token: 'admin-delete-token',
      updatedAt: new Date(),
      userId: ids.member,
    });
    await serverDB.insert(apiKeys).values({
      id: 'admin-delete-api-key',
      key: 'admin-delete-key',
      name: 'delete-test',
      userId: ids.member,
    });

    await new AdminConsoleModel(serverDB, ids.actor).deleteUser(ids.member);

    await expect(findUser(ids.member)).resolves.toBeUndefined();
    await expect(
      serverDB.select().from(session).where(eq(session.userId, ids.member)),
    ).resolves.toHaveLength(0);
    await expect(
      serverDB.select().from(apiKeys).where(eq(apiKeys.userId, ids.member)),
    ).resolves.toHaveLength(0);
  });

  it('frees the email and username so the person can register again', async () => {
    await new AdminConsoleModel(serverDB, ids.actor).deleteUser(ids.member);

    await expect(
      serverDB.insert(users).values({
        email: 'member@example.com',
        id: 'admin-delete-member-again',
        normalizedEmail: 'member@example.com',
        role: 'user',
        username: 'D0004',
      }),
    ).resolves.toBeDefined();

    await serverDB.delete(users).where(eq(users.id, 'admin-delete-member-again'));
  });
});
