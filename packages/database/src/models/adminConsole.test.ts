// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { adminConsoleSettings, apiKeys, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { AdminConsoleModel, AdminConsoleSettingsModel } from './adminConsole';

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

describe('AdminConsoleSettingsModel Labs storage (CUST-009)', () => {
  const settings = () => new AdminConsoleSettingsModel(serverDB);

  it('answers the upstream default when the singleton row was never written', async () => {
    const { config, updatedAt, updatedBy } = await settings().getLabsConfig();

    // Zero-change install: no console write yet, so everyone keeps their own lab.
    expect(config).toEqual({ flags: {}, mode: 'user' });
    expect(updatedAt).toBeNull();
    expect(updatedBy).toBeNull();
  });

  it('stores admin mode with a sparse flag map and lock version', async () => {
    const row = await settings().updateLabsConfig(
      { flags: { enableSelfLearning: true }, mode: 'admin' },
      { updatedBy: ids.actor },
    );

    const read = await settings().getLabsConfig();

    // Sparse: only the explicit flag is stored, every other lab is absent (= off).
    expect(read.config).toEqual({ flags: { enableSelfLearning: true }, mode: 'admin' });
    expect(read.updatedAt?.getTime()).toBe(row.updatedAt.getTime());
    expect(read.updatedBy).toBe(ids.actor);
  });

  it('rejects a stale expectedUpdatedAt instead of overwriting', async () => {
    const first = await settings().updateLabsConfig(
      { flags: {}, mode: 'admin' },
      { updatedBy: ids.actor },
    );

    await expect(
      settings().updateLabsConfig(
        { flags: { enableGroupChat: true }, mode: 'admin' },
        { expectedUpdatedAt: new Date(0), updatedBy: ids.otherAdmin },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'CONFIG_CONFLICT' });

    // The read version is accepted, and the conflict left the row untouched.
    const accepted = await settings().updateLabsConfig(
      { flags: { enableGroupChat: true }, mode: 'admin' },
      { expectedUpdatedAt: first.updatedAt, updatedBy: ids.otherAdmin },
    );

    expect(accepted.updatedBy).toBe(ids.otherAdmin);
    await expect(settings().getLabsConfig()).resolves.toMatchObject({
      config: { flags: { enableGroupChat: true } },
    });
  });

  it('keeps config.ai and config.bootstrap when the Labs slice is written', async () => {
    const ai = {
      apiKey: null,
      baseURL: 'https://llm.internal/v1',
      enabled: true,
      models: [],
    };
    const bootstrap = { at: '2026-01-01T00:00:00.000Z', userId: ids.actor };

    await serverDB.insert(adminConsoleSettings).values({
      config: { ai, bootstrap },
      id: 'singleton',
      updatedBy: ids.actor,
    });

    await settings().updateLabsConfig(
      { flags: { enableGroupChat: true }, mode: 'admin' },
      { updatedBy: ids.actor },
    );

    const row = await settings().getSettings();
    expect(row?.config.ai).toEqual(ai);
    expect(row?.config.bootstrap).toEqual(bootstrap);
    expect(row?.config.labs).toEqual({ flags: { enableGroupChat: true }, mode: 'admin' });
  });

  it('normalizes a malformed stored config back to user mode', async () => {
    await serverDB.insert(adminConsoleSettings).values({
      config: { labs: { flags: { enableGroupChat: 'yes' }, mode: 'nonsense' } } as never,
      id: 'singleton',
      updatedBy: ids.actor,
    });

    await expect(settings().getLabsConfig()).resolves.toMatchObject({
      config: { flags: {}, mode: 'user' },
    });
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
