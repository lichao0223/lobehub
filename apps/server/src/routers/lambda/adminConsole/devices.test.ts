// @vitest-environment node
import type { AdminDeviceSummary } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { devices, users, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { collectPrincipals, probePrincipals, resolveOnlineStates, tallyOnline } from './devices';
import { adminConsoleRouter } from './index';

const mocks = vi.hoisted(() => ({
  getServerDB: vi.fn(),
  isConfigured: true,
  readDeviceList: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
// Presence reads go through the gateway singleton only; the rest of the service
// stays real so the admin router keeps its production import graph.
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: {
    get isConfigured() {
      return mocks.isConfigured;
    },
    // The failure-aware read: the admin overview must be able to tell "no
    // devices online" from "the gateway did not answer".
    readDeviceList: mocks.readDeviceList,
  },
}));

const serverDB: LobeChatDatabase = await getTestDB();
mocks.getServerDB.mockResolvedValue(serverDB);

const ids = {
  admin: 'admin-devices-admin',
  alice: 'admin-devices-alice',
  bob: 'admin-devices-bob',
};

const ws = 'admin-devices-ws';

/** A live gateway device as `deviceGateway.readDeviceList` returns it. */
const live = (deviceId: string, channelCount = 1) => ({
  channels: Array.from({ length: channelCount }, (_, index) => ({
    channel: 'desktop',
    connectedAt: '2026-01-01T00:00:00.000Z',
    connectionId: `${deviceId}-${index}`,
  })),
  deviceId,
  hostname: `${deviceId}.local`,
  lastSeen: '2026-01-01T00:00:00.000Z',
  online: true,
  platform: 'linux',
});

/** A readable pool, as `readDeviceList` reports it. */
const readable = (devices: ReturnType<typeof live>[]) => ({ devices, ok: true as const });

/** Alice's laptop has two channels; the workspace machine has one. */
const gatewayAnswer = async (userId: string, workspaceId?: string) => {
  if (workspaceId === ws) return readable([live('ws-shared')]);
  if (userId === ids.alice) return readable([live('alice-laptop', 2)]);
  return readable([]);
};

const callerFor = (userId?: string) => adminConsoleRouter.createCaller({ userId } as never);
const admin = () => callerFor(ids.admin);

const byId = (items: AdminDeviceSummary[], deviceId: string) => {
  const item = items.find((device) => device.deviceId === deviceId);
  if (!item) throw new Error(`missing device ${deviceId}`);
  return item;
};

beforeEach(async () => {
  mocks.isConfigured = true;
  mocks.getServerDB.mockResolvedValue(serverDB);
  mocks.readDeviceList.mockReset();
  mocks.readDeviceList.mockImplementation(gatewayAnswer);

  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { email: 'admin@example.com', id: ids.admin, role: 'admin', username: 'admin' },
    { email: 'alice@example.com', fullName: 'Alice Zhang', id: ids.alice, username: 'alice' },
    { email: 'bob@example.com', id: ids.bob, username: 'bob' },
  ]);
  await serverDB.insert(workspaces).values({
    id: ws,
    name: 'Alpha Team',
    primaryOwnerId: ids.alice,
    slug: 'alpha-team',
  });

  await serverDB.insert(devices).values([
    {
      // Private filesystem fields must never reach the admin projection.
      defaultCwd: '/Users/alice/secret-project',
      deviceId: 'alice-laptop',
      friendlyName: 'Alice Laptop',
      hostname: 'alice-mac.local',
      identitySource: 'machine-id',
      lastSeenAt: new Date(),
      platform: 'darwin',
      userId: ids.alice,
      workingDirs: [{ path: '/Users/alice/work' }],
    },
    {
      deviceId: 'alice-spare',
      hostname: 'alice-nuc.local',
      identitySource: 'machine-id',
      lastSeenAt: new Date(),
      platform: 'linux',
      userId: ids.alice,
    },
    {
      deviceId: 'bob-desktop',
      hostname: 'bob-win.local',
      identitySource: 'machine-id',
      lastSeenAt: new Date(),
      platform: 'win32',
      userId: ids.bob,
    },
    {
      deviceId: 'ws-shared',
      hostname: 'ws-box.local',
      identitySource: 'machine-id',
      lastSeenAt: new Date(),
      platform: 'linux',
      sharedFromDeviceId: 'bob-desktop',
      userId: ids.bob,
      visibility: 'private',
      workspaceId: ws,
    },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('admin device access', () => {
  it('rejects a normal user and an anonymous caller on all three procedures', async () => {
    const member = callerFor(ids.alice);

    await expect(member.listDevices()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'ADMIN_REQUIRED',
    });
    await expect(member.getDevice({ deviceId: 'alice-laptop' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'ADMIN_REQUIRED',
    });
    await expect(member.getDeviceStats()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'ADMIN_REQUIRED',
    });

    const anonymous = callerFor();
    await expect(anonymous.listDevices()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(mocks.readDeviceList).not.toHaveBeenCalled();
  });

  it('lists devices of every owner and workspace', async () => {
    const result = await admin().listDevices();

    expect(result.total).toBe(4);
    expect(result.items.map((item) => item.deviceId).sort()).toEqual([
      'alice-laptop',
      'alice-spare',
      'bob-desktop',
      'ws-shared',
    ]);

    const laptop = byId(result.items, 'alice-laptop');
    expect(laptop.owner).toMatchObject({ fullName: 'Alice Zhang', userId: ids.alice });
    expect(laptop.workspace).toBeNull();

    const shared = byId(result.items, 'ws-shared');
    expect(shared.visibility).toBe('private');
    expect(shared.workspace).toMatchObject({ name: 'Alpha Team', workspaceId: ws });
  });
});

describe('listDevices presence', () => {
  it('marks hits online, misses offline, and counts channels', async () => {
    const result = await admin().listDevices();

    expect(byId(result.items, 'alice-laptop')).toMatchObject({ channelCount: 2, online: 'online' });
    expect(byId(result.items, 'ws-shared')).toMatchObject({ channelCount: 1, online: 'online' });
    // Probed principals that do not report the device mean offline, not unknown.
    expect(byId(result.items, 'alice-spare')).toMatchObject({ channelCount: 0, online: 'offline' });
    expect(byId(result.items, 'bob-desktop')).toMatchObject({ channelCount: 0, online: 'offline' });

    expect(result.onlineStats).toEqual({ offline: 2, online: 2, unknown: 0 });
  });

  it('probes each principal once and addresses workspace pools by workspace', async () => {
    await admin().listDevices();

    // (alice, personal), (bob, personal), (bob, workspace) — alice's two rows share one probe.
    expect(mocks.readDeviceList).toHaveBeenCalledTimes(3);
    expect(mocks.readDeviceList).toHaveBeenCalledWith(ids.alice, undefined);
    expect(mocks.readDeviceList).toHaveBeenCalledWith(ids.bob, undefined);
    expect(mocks.readDeviceList).toHaveBeenCalledWith(ids.bob, ws);
  });

  it('answers unknown without a gateway request when the gateway is not configured', async () => {
    mocks.isConfigured = false;

    const result = await admin().listDevices();

    expect(result.items.every((item) => item.online === 'unknown')).toBe(true);
    expect(result.onlineStats).toEqual({ offline: 0, online: 0, unknown: 4 });
    expect(mocks.readDeviceList).not.toHaveBeenCalled();
  });

  it('answers unknown when the gateway request rejects', async () => {
    mocks.readDeviceList.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await admin().listDevices();

    expect(result.items.every((item) => item.online === 'unknown')).toBe(true);
    expect(result.onlineStats).toEqual({ offline: 0, online: 0, unknown: 4 });
  });

  it('answers unknown, never offline, when the gateway reports an unreadable pool', async () => {
    // The gateway read failed and said so. An administrator must see "we could
    // not ask", not a page full of devices marked offline.
    mocks.readDeviceList.mockResolvedValue({ ok: false, reason: 'DEVICE_GATEWAY_UNREACHABLE' });

    const result = await admin().listDevices();

    expect(result.items.every((item) => item.online === 'unknown')).toBe(true);
    expect(result.onlineStats).toEqual({ offline: 0, online: 0, unknown: 4 });
  });

  it('narrows by the resolved presence state', async () => {
    const online = await admin().listDevices({ online: 'online' });
    expect(online.items.map((item) => item.deviceId).sort()).toEqual(['alice-laptop', 'ws-shared']);
    expect(online.onlineStats).toEqual({ offline: 0, online: 2, unknown: 0 });

    mocks.isConfigured = false;
    const unknown = await admin().listDevices({ online: 'unknown' });
    expect(unknown.items).toHaveLength(4);
    expect(unknown.onlineStats).toEqual({ offline: 0, online: 0, unknown: 4 });
  });
});

describe('listDevices filters', () => {
  it('paginates and keeps the SQL total', async () => {
    const result = await admin().listDevices({ page: 2, pageSize: 2 });

    expect(result.items).toHaveLength(2);
    expect(result).toMatchObject({ page: 2, pageSize: 2, total: 4 });
  });

  it('filters by scope, workspace, visibility, platform and search', async () => {
    expect((await admin().listDevices({ scope: 'personal' })).total).toBe(3);

    const workspace = await admin().listDevices({ scope: 'workspace' });
    expect(workspace.items.map((item) => item.deviceId)).toEqual(['ws-shared']);

    expect((await admin().listDevices({ workspaceId: ws })).total).toBe(1);
    expect((await admin().listDevices({ visibility: 'private' })).total).toBe(1);
    expect((await admin().listDevices({ visibility: 'public' })).total).toBe(0);
    expect((await admin().listDevices({ platform: 'win32' })).total).toBe(1);

    // Search covers device names, hostnames and owner identity.
    expect((await admin().listDevices({ q: 'nuc' })).items.map((item) => item.deviceId)).toEqual([
      'alice-spare',
    ]);
    expect(
      (await admin().listDevices({ q: 'bob' })).items.map((item) => item.deviceId).sort(),
    ).toEqual(['bob-desktop', 'ws-shared']);
  });

  it('rejects a page size above the cap', async () => {
    await expect(admin().listDevices({ pageSize: 101 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('getDevice', () => {
  it('returns live channels for an online device and never leaks private paths', async () => {
    const device = await admin().getDevice({ deviceId: 'alice-laptop' });

    expect(device).toMatchObject({ channelCount: 2, online: 'online' });
    expect(device.channels).toHaveLength(2);
    expect(device.channels[0]).toMatchObject({ channel: 'desktop' });
    expect(device.channels[0].connectedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(device)).not.toContain('/Users/alice');
  });

  it('addresses workspace rows explicitly and reports NOT_FOUND otherwise', async () => {
    const shared = await admin().getDevice({ deviceId: 'ws-shared', workspaceId: ws });
    expect(shared).toMatchObject({ online: 'online' });
    expect(shared.workspace).toMatchObject({ workspaceId: ws });

    // The row exists, but not under the personal pool / another workspace.
    await expect(admin().getDevice({ deviceId: 'ws-shared' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      admin().getDevice({ deviceId: 'ws-shared', workspaceId: 'other-ws' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('marks a probed miss offline and a failed probe unknown', async () => {
    const offline = await admin().getDevice({ deviceId: 'bob-desktop' });
    expect(offline).toMatchObject({ channelCount: 0, online: 'offline' });
    expect(offline.channels).toEqual([]);

    mocks.readDeviceList.mockRejectedValue(new Error('gateway down'));
    const unknown = await admin().getDevice({ deviceId: 'bob-desktop' });
    expect(unknown).toMatchObject({ channelCount: 0, online: 'unknown' });

    mocks.isConfigured = false;
    expect(await admin().getDevice({ deviceId: 'alice-laptop' })).toMatchObject({
      online: 'unknown',
    });
  });
});

describe('getDeviceStats', () => {
  it('forwards the aggregate counters without touching the gateway', async () => {
    const stats = await admin().getDeviceStats();

    expect(stats).toMatchObject({
      activeLast7d: 4,
      personal: 3,
      total: 4,
      workspace: 1,
      workspaceCount: 1,
    });
    expect(stats.byPlatform).toEqual({ darwin: 1, linux: 2, win32: 1 });
    expect(mocks.readDeviceList).not.toHaveBeenCalled();
  });
});

// ── pure presence helpers ────────────────────────────────────────────────

const summary = (
  deviceId: string,
  options: { ownerId?: string; workspaceId?: string | null } = {},
): AdminDeviceSummary => {
  const { ownerId = ids.alice, workspaceId = null } = options;

  return {
    architecture: null,
    channelCount: 0,
    deviceId,
    firstSeenAt: new Date(),
    friendlyName: null,
    hostname: null,
    identitySource: 'machine-id',
    lastSeenAt: new Date(),
    online: 'unknown',
    owner: { avatar: null, email: null, fullName: null, userId: ownerId, username: null },
    platform: null,
    scope: workspaceId ? 'workspace' : 'personal',
    sharedFromDeviceId: null,
    visibility: null,
    workspace: workspaceId ? { name: 'Team', workspaceId } : null,
  };
};

describe('presence helpers', () => {
  it('deduplicates rows into principals, skipping rows without a resolved owner', () => {
    const principals = collectPrincipals([
      summary('a'),
      summary('b'),
      summary('c', { workspaceId: ws }),
      summary('d', { workspaceId: ws }),
      summary('e', { ownerId: '' }),
    ]);

    expect(principals).toEqual([
      { userId: ids.alice, workspaceId: null },
      { userId: ids.alice, workspaceId: ws },
    ]);
  });

  it('resolves online / offline / unknown and tallies the page', () => {
    const probes = new Map([
      [`${ids.alice}::`, { devices: new Map([['a', live('a', 3)]]), ok: true as const }],
      [`${ids.alice}::${ws}`, { ok: false as const }],
    ]);

    const items = resolveOnlineStates(
      [
        summary('a'),
        summary('b'),
        summary('c', { workspaceId: ws }),
        summary('d', { ownerId: '' }),
      ],
      probes,
    );

    expect(items.map((item) => [item.deviceId, item.online, item.channelCount])).toEqual([
      ['a', 'online', 3],
      ['b', 'offline', 0],
      ['c', 'unknown', 0],
      ['d', 'unknown', 0],
    ]);
    expect(tallyOnline(items)).toEqual({ offline: 1, online: 1, unknown: 2 });
    // The original rows are untouched — the model still owns the stored shape.
    expect(items[0].deviceId).toBe('a');
  });

  it('makes no request when the gateway is not configured', async () => {
    const read = vi.fn();

    const probes = await probePrincipals([{ userId: ids.alice, workspaceId: null }], {
      configured: false,
      read,
    });

    expect(read).not.toHaveBeenCalled();
    expect(probes.size).toBe(0);
  });

  it('bounds concurrency to 5 probes in flight', async () => {
    let active = 0;
    let peak = 0;
    const read = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return readable([]);
    };

    const principals = Array.from({ length: 12 }, (_, index) => ({
      userId: `user-${index}`,
      workspaceId: null,
    }));
    const probes = await probePrincipals(principals, { read, timeoutMs: 1000 });

    expect(probes.size).toBe(12);
    expect(peak).toBe(5);
  });

  it('records an unreadable pool as a failed probe, not an empty one', async () => {
    const probes = await probePrincipals([{ userId: ids.alice, workspaceId: null }], {
      read: async () => ({ ok: false, reason: 'DEVICE_GATEWAY_UNREACHABLE' }),
    });

    expect(probes.get(`${ids.alice}::`)).toEqual({ ok: false });
  });

  it('drops principals that outlive the budget and ignores their late results', async () => {
    let release: ((value: { devices: never[]; ok: true }) => void) | undefined;
    const stuck = new Promise<{ devices: never[]; ok: true }>((resolve) => {
      release = resolve;
    });
    const read = (principal: { userId: string }) =>
      principal.userId === 'slow' ? stuck : Promise.resolve(readable([]));

    const probes = await probePrincipals(
      [
        { userId: 'fast', workspaceId: null },
        { userId: 'slow', workspaceId: null },
      ],
      { read, timeoutMs: 20 },
    );

    expect([...probes.values()].every((probe) => probe.ok)).toBe(true);
    expect(probes.size).toBe(1);

    // The abandoned request settles after the answer went out: the returned map
    // must not change.
    release?.(readable([]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(probes.size).toBe(1);
  });
});
