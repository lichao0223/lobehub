// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, devices, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AdminConsoleModel } from '../adminConsole';

const serverDB: LobeChatDatabase = await getTestDB();

const ids = {
  admin: 'admin-console-device-admin',
  alice: 'admin-console-device-alice',
  bob: 'admin-console-device-bob',
};

const ws1 = 'admin-console-device-ws-1';
const ws2 = 'admin-console-device-ws-2';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

const modelFor = (userId: string) => new AdminConsoleModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { email: 'admin@example.com', id: ids.admin, role: 'admin', username: 'admin' },
    {
      email: 'alice@example.com',
      firstName: 'Alice',
      fullName: 'Alice Zhang',
      id: ids.alice,
      role: 'user',
      username: 'alice',
    },
    {
      email: 'bob@example.com',
      fullName: 'Bob Li',
      id: ids.bob,
      role: 'user',
      username: 'bob',
    },
  ]);
  await serverDB.insert(workspaces).values([
    { id: ws1, name: 'Alpha Team', primaryOwnerId: ids.alice, slug: 'alpha-team' },
    { id: ws2, name: 'Beta Team', primaryOwnerId: ids.bob, slug: 'beta-team' },
  ]);

  await serverDB.insert(devices).values([
    // Personal devices, including one whose private filesystem fields must
    // never leave the admin projection.
    {
      defaultCwd: '/Users/alice/secret-project',
      deviceId: 'alice-personal',
      friendlyName: 'Alice Mac',
      hostname: 'alice-mac.local',
      identitySource: 'machine-id',
      lastSeenAt: daysAgo(0),
      metadata: { appVersion: '2.0.0', cliVersion: '1.2.3', node: '22.0.0' },
      platform: 'darwin',
      recentCwds: ['/Users/alice/old-project'],
      userId: ids.alice,
      workingDirs: [{ path: '/Users/alice/work' }],
    },
    {
      deviceId: 'bob-personal',
      hostname: 'bob-win',
      identitySource: 'machine-id',
      lastSeenAt: daysAgo(10),
      platform: 'win32',
      userId: ids.bob,
    },
    // Workspace enrollments: one public, two private (one of them enrolled by
    // a member other than the viewer — an admin still sees it).
    {
      deviceId: 'ws1-private-alice',
      identitySource: 'machine-id',
      lastSeenAt: daysAgo(1),
      platform: 'darwin',
      userId: ids.alice,
      visibility: 'private',
      workspaceId: ws1,
    },
    {
      deviceId: 'ws1-private-bob',
      identitySource: 'machine-id',
      lastSeenAt: daysAgo(2),
      platform: 'darwin',
      sharedFromDeviceId: 'bob-personal',
      userId: ids.bob,
      visibility: 'private',
      workspaceId: ws1,
    },
    {
      deviceId: 'ws1-public',
      identitySource: 'machine-id',
      lastSeenAt: daysAgo(3),
      platform: 'linux',
      userId: ids.alice,
      visibility: 'public',
      workspaceId: ws1,
    },
    {
      deviceId: 'ws2-only',
      identitySource: 'machine-id',
      lastSeenAt: daysAgo(8),
      platform: 'linux',
      userId: ids.bob,
      visibility: 'public',
      workspaceId: ws2,
    },
  ]);
});

/**
 * Same deviceId under two personal owners. `lh connect --device-id` pins an
 * explicit id, so the "deviceId mixes in the principal" assumption does not
 * hold for every row: a personal row is identified by (userId, deviceId).
 */
const insertPinnedTwin = async () => {
  await serverDB.insert(devices).values([
    {
      deviceId: 'shared-probe-id',
      hostname: 'alice-pinned',
      identitySource: 'fallback',
      lastSeenAt: daysAgo(4),
      platform: 'linux',
      userId: ids.alice,
    },
    {
      deviceId: 'shared-probe-id',
      hostname: 'bob-pinned',
      identitySource: 'fallback',
      lastSeenAt: daysAgo(5),
      platform: 'win32',
      userId: ids.bob,
    },
  ]);
};

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AdminConsoleModel.listDevices', () => {
  it('lists every device across owners and workspaces, including private rows', async () => {
    const result = await modelFor(ids.admin).listDevices();

    expect(result.total).toBe(6);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.items.map((item) => item.deviceId).sort()).toEqual(
      [
        'alice-personal',
        'bob-personal',
        'ws1-private-alice',
        'ws1-private-bob',
        'ws1-public',
        'ws2-only',
      ].sort(),
    );

    const otherPrivate = result.items.find((item) => item.deviceId === 'ws1-private-bob');
    expect(otherPrivate).toMatchObject({
      scope: 'workspace',
      visibility: 'private',
      sharedFromDeviceId: 'bob-personal',
      workspace: { name: 'Alpha Team', workspaceId: ws1 },
    });

    // Presence is gateway state; the model never invents online/offline.
    expect(result.items.every((item) => item.online === 'unknown')).toBe(true);
    expect(result.items.every((item) => item.channelCount === 0)).toBe(true);
    expect(result.onlineStats).toEqual({ offline: 0, online: 0, unknown: 0 });
  });

  it('projects only the whitelist: no cwd fields and no raw metadata', async () => {
    const result = await modelFor(ids.admin).listDevices();
    const alicePersonal = result.items.find((item) => item.deviceId === 'alice-personal')!;

    expect(alicePersonal).toMatchObject({
      friendlyName: 'Alice Mac',
      hostname: 'alice-mac.local',
      identitySource: 'machine-id',
      platform: 'darwin',
      scope: 'personal',
      visibility: null,
      workspace: null,
      owner: {
        email: 'alice@example.com',
        fullName: 'Alice Zhang',
        userId: ids.alice,
        username: 'alice',
      },
    });

    for (const key of ['defaultCwd', 'workingDirs', 'recentCwds', 'metadata']) {
      expect(alicePersonal).not.toHaveProperty(key);
    }
    expect(JSON.stringify(result)).not.toContain('/Users/alice');
  });

  it('searches by owner email and by hostname', async () => {
    const model = modelFor(ids.admin);

    const byEmail = await model.listDevices({ q: 'bob@example.com' });
    expect(byEmail.items.map((item) => item.deviceId).sort()).toEqual([
      'bob-personal',
      'ws1-private-bob',
      'ws2-only',
    ]);

    const byHostname = await model.listDevices({ q: 'alice-mac' });
    expect(byHostname.items.map((item) => item.deviceId)).toEqual(['alice-personal']);
    expect(byHostname.total).toBe(1);
  });

  it('filters by scope, workspace, visibility and platform', async () => {
    const model = modelFor(ids.admin);

    expect((await model.listDevices({ scope: 'personal' })).total).toBe(2);
    expect((await model.listDevices({ scope: 'workspace' })).total).toBe(4);

    const ws1Devices = await model.listDevices({ workspaceId: ws1 });
    expect(ws1Devices.items.map((item) => item.deviceId).sort()).toEqual([
      'ws1-private-alice',
      'ws1-private-bob',
      'ws1-public',
    ]);

    const privateRows = await model.listDevices({ visibility: 'private' });
    // Personal rows store the column default but expose no visibility, so the
    // filter must not surface them.
    expect(privateRows.items.map((item) => item.deviceId).sort()).toEqual([
      'ws1-private-alice',
      'ws1-private-bob',
    ]);

    expect((await model.listDevices({ visibility: 'public' })).total).toBe(2);
    expect((await model.listDevices({ platform: 'linux' })).total).toBe(2);
    expect((await model.listDevices({ platform: 'win32' })).total).toBe(1);
  });

  it('paginates deterministically and reports the unfiltered-scope total', async () => {
    const model = modelFor(ids.admin);

    const firstPage = await model.listDevices({ page: 1, pageSize: 2 });
    const secondPage = await model.listDevices({ page: 2, pageSize: 2 });

    expect(firstPage.total).toBe(6);
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(2);
    expect(firstPage.items.map((item) => item.deviceId)).toEqual([
      'alice-personal',
      'ws1-private-alice',
    ]);
    expect(secondPage.items.map((item) => item.deviceId)).toEqual([
      'ws1-private-bob',
      'ws1-public',
    ]);

    const clamped = await model.listDevices({ pageSize: 1000 });
    expect(clamped.pageSize).toBe(100);
  });
});

describe('AdminConsoleModel.getDevice', () => {
  it('reads a personal device with only the whitelisted metadata keys', async () => {
    const device = await modelFor(ids.admin).getDevice('alice-personal', { workspaceId: null });

    expect(device).toMatchObject({
      appVersion: '2.0.0',
      channels: [],
      cliVersion: '1.2.3',
      deviceId: 'alice-personal',
      hasFixedAgentBinding: false,
      scope: 'personal',
      visibility: null,
    });
    for (const key of ['defaultCwd', 'workingDirs', 'recentCwds', 'metadata']) {
      expect(device).not.toHaveProperty(key);
    }
    expect(JSON.stringify(device)).not.toContain('/Users/alice');
  });

  it('reads another member’s private workspace device by (workspaceId, deviceId)', async () => {
    const device = await modelFor(ids.admin).getDevice('ws1-private-bob', { workspaceId: ws1 });

    expect(device).toMatchObject({
      deviceId: 'ws1-private-bob',
      scope: 'workspace',
      sharedFromDeviceId: 'bob-personal',
      visibility: 'private',
      workspace: { name: 'Alpha Team', slug: 'alpha-team', workspaceId: ws1 },
    });
  });

  it('does not cross the personal / workspace pools', async () => {
    const model = modelFor(ids.admin);

    expect(await model.getDevice('alice-personal', { workspaceId: ws1 })).toBeUndefined();
    expect(await model.getDevice('ws1-public', { workspaceId: null })).toBeUndefined();
    expect(await model.getDevice('missing-device', { workspaceId: null })).toBeUndefined();
  });

  it('addresses a personal row by (ownerId, deviceId) when two owners share an id', async () => {
    await insertPinnedTwin();
    const model = modelFor(ids.admin);

    const alice = await model.getDevice('shared-probe-id', {
      ownerId: ids.alice,
      workspaceId: null,
    });
    const bob = await model.getDevice('shared-probe-id', { ownerId: ids.bob, workspaceId: null });

    // Getting this wrong shows the administrator somebody else's machine.
    expect(alice).toMatchObject({ deviceId: 'shared-probe-id', hostname: 'alice-pinned' });
    expect(alice?.owner).toMatchObject({ email: 'alice@example.com', userId: ids.alice });
    expect(bob).toMatchObject({ deviceId: 'shared-probe-id', hostname: 'bob-pinned' });
    expect(bob?.owner).toMatchObject({ email: 'bob@example.com', userId: ids.bob });
  });

  it('refuses an ambiguous personal id instead of picking an arbitrary row', async () => {
    await insertPinnedTwin();

    // Legacy callers omit ownerId; with two owners the address is ambiguous, so
    // the console must say "not found" rather than silently show one of them.
    expect(
      await modelFor(ids.admin).getDevice('shared-probe-id', { workspaceId: null }),
    ).toBeUndefined();

    // A unique personal id stays addressable without ownerId.
    expect(
      await modelFor(ids.admin).getDevice('bob-personal', { workspaceId: null }),
    ).toMatchObject({ deviceId: 'bob-personal', hostname: 'bob-win' });
  });

  it('reports a fixed agent binding as a boolean only', async () => {
    await serverDB.insert(agents).values({
      agencyConfig: {
        boundDeviceId: 'ws1-public',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      },
      id: 'admin-device-fixed-agent',
      title: 'Fixed agent',
      userId: ids.alice,
      workspaceId: ws1,
    });

    const device = await modelFor(ids.admin).getDevice('ws1-public', { workspaceId: ws1 });
    expect(device?.hasFixedAgentBinding).toBe(true);
    expect(JSON.stringify(device)).not.toContain('admin-device-fixed-agent');
  });
});

describe('AdminConsoleModel.getDeviceStats', () => {
  it('counts totals, scopes, platforms and recent activity', async () => {
    const stats = await modelFor(ids.admin).getDeviceStats();

    expect(stats).toEqual({
      activeLast7d: 4,
      byPlatform: { darwin: 3, linux: 2, win32: 1 },
      personal: 2,
      total: 6,
      workspace: 4,
      workspaceCount: 2,
    });
  });

  it('returns zeroes on an empty deployment', async () => {
    await serverDB.delete(devices);

    const stats = await modelFor(ids.admin).getDeviceStats();
    expect(stats).toEqual({
      activeLast7d: 0,
      byPlatform: {},
      personal: 0,
      total: 0,
      workspace: 0,
      workspaceCount: 0,
    });
  });
});
