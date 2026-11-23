// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { adminConsoleSettings, apiKeys, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { AdminConsoleModel } from './adminConsole';

const serverDB: LobeChatDatabase = await getTestDB();

const ids = {
  actor: 'admin-console-guard-actor',
  banned: 'admin-console-guard-banned',
  lastAdmin: 'admin-console-guard-last-admin',
  member: 'admin-console-guard-member',
  otherAdmin: 'admin-console-guard-other-admin',
};

beforeEach(async () => {
  await serverDB.delete(adminConsoleSettings).where(eq(adminConsoleSettings.id, 'singleton'));
  await serverDB.delete(users).where(inArray(users.id, Object.values(ids)));

  await serverDB.insert(users).values([
    { id: ids.actor, email: 'actor@example.com', role: 'admin', username: 'A0001' },
    { id: ids.otherAdmin, email: 'other@example.com', role: 'admin', username: 'A0002' },
    { id: ids.lastAdmin, email: 'last@example.com', role: 'admin', username: 'A0003' },
    { id: ids.member, email: 'member@example.com', role: 'user', username: 'A0004' },
    { id: ids.banned, banned: true, email: 'banned@example.com', role: 'user', username: 'A0005' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(adminConsoleSettings).where(eq(adminConsoleSettings.id, 'singleton'));
  await serverDB.delete(users).where(inArray(users.id, Object.values(ids)));
});

const modelFor = (userId: string) => new AdminConsoleModel(serverDB, userId);

describe('AdminConsoleModel last-admin protection', () => {
  it('refuses to demote the only enabled admin', async () => {
    // Leave one enabled admin by demoting the others through the model first.
    await serverDB
      .update(users)
      .set({ role: 'user' })
      .where(inArray(users.id, [ids.actor, ids.otherAdmin]));

    await expect(modelFor(ids.lastAdmin).setRole(ids.lastAdmin, 'user')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'SELF_LOCKOUT',
    });

    const survivor = new AdminConsoleModel(serverDB, ids.actor);
    await expect(survivor.setRole(ids.lastAdmin, 'user')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'LAST_ADMIN',
    });

    const [row] = await serverDB
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, ids.lastAdmin));
    expect(row.role).toBe('admin');
  });

  it('refuses to ban the only enabled admin', async () => {
    await serverDB
      .update(users)
      .set({ role: 'user' })
      .where(inArray(users.id, [ids.actor, ids.otherAdmin]));

    await expect(
      new AdminConsoleModel(serverDB, ids.actor).banUser(ids.lastAdmin, 'cleanup'),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'LAST_ADMIN' });
  });

  it('refuses to change or ban the acting admin', async () => {
    const model = modelFor(ids.actor);
    await expect(model.setRole(ids.actor, 'user')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'SELF_LOCKOUT',
    });
    await expect(model.banUser(ids.actor, 'oops')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'SELF_LOCKOUT',
    });
  });
});

describe('AdminConsoleModel ban and unban cascade', () => {
  it('disables API keys, marks the account banned, and revokes sessions', async () => {
    await serverDB.insert(apiKeys).values({
      key: 'encrypted',
      keyHash: 'hash-ban-cascade',
      name: 'CI key',
      userId: ids.member,
    });

    const result = await modelFor(ids.actor).banUser(ids.member, 'Policy violation');

    expect(result?.banned).toBe(true);
    expect(result?.banReason).toBe('Policy violation');
    expect(result?.revokedSessions).toBe(0);

    const [key] = await serverDB
      .select({ enabled: apiKeys.enabled })
      .from(apiKeys)
      .where(eq(apiKeys.userId, ids.member));
    expect(key.enabled).toBe(false);

    const unban = await modelFor(ids.actor).unbanUser(ids.member);
    expect(unban?.banned).toBe(false);
    expect(unban?.banReason).toBeNull();
  });
});

describe('AdminConsoleModel listUsers', () => {
  it('searches and filters without exposing another tenant', async () => {
    const model = modelFor(ids.actor);

    const banned = await model.listUsers({ status: 'banned' });
    expect(banned.items.map((item) => item.id)).toContain(ids.banned);
    expect(banned.items.every((item) => item.banned)).toBe(true);

    const admins = await model.listUsers({ role: 'admin' });
    expect(admins.items.map((item) => item.id).sort()).toEqual(
      [ids.actor, ids.lastAdmin, ids.otherAdmin].sort(),
    );

    const searched = await model.listUsers({ q: 'member@example' });
    expect(searched.items.map((item) => item.id)).toEqual([ids.member]);
  });
});
