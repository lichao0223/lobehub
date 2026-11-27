// @vitest-environment node
import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { devices, users, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { adminConsoleRouter } from './index';

const mocks = vi.hoisted(() => {
  class TopicModel {
    static instances: TopicModel[] = [];

    constructor(
      public db: unknown,
      public userId: string,
      public workspaceId?: string,
    ) {
      TopicModel.instances.push(this);
    }

    findRunInitiators = vi.fn(async () => new Map<string, string>());

    queryTopics = vi.fn(async () => []);
  }

  return {
    TopicModel,
    createTerminalSession: vi.fn(),
    executeToolCall: vi.fn(),
    getDisplayInfoByIds: vi.fn(async () => []),
    getLocalFilePreview: vi.fn(),
    listProjectDirectory: vi.fn(),
    loadDeviceBoundAgents: vi.fn(async () => []),
    queryDeviceMetrics: vi.fn(async () => []),
    queryDeviceSystemInfo: vi.fn(),
    readTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    searchProjectFiles: vi.fn(),
    statPath: vi.fn(),
    writeTerminal: vi.fn(),
    getServerDB: vi.fn(),
  };
});

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
vi.mock('@/database/models/topic', () => ({ TopicModel: mocks.TopicModel }));
vi.mock('@/database/models/user', () => ({
  UserModel: { getDisplayInfoByIds: mocks.getDisplayInfoByIds },
}));
vi.mock('../deviceBoundAgents', () => ({
  loadDeviceBoundAgents: mocks.loadDeviceBoundAgents,
}));
// The gateway is the only seam that talks to a device; everything else in the
// admin router stays real so the import graph matches production.
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: {
    createTerminalSession: mocks.createTerminalSession,
    executeToolCall: mocks.executeToolCall,
    getLocalFilePreview: mocks.getLocalFilePreview,
    listProjectDirectory: mocks.listProjectDirectory,
    queryDeviceMetrics: mocks.queryDeviceMetrics,
    queryDeviceSystemInfo: mocks.queryDeviceSystemInfo,
    readTerminal: mocks.readTerminal,
    resizeTerminal: mocks.resizeTerminal,
    searchProjectFiles: mocks.searchProjectFiles,
    statPath: mocks.statPath,
    writeTerminal: mocks.writeTerminal,
  },
}));

const serverDB: LobeChatDatabase = await getTestDB();
mocks.getServerDB.mockResolvedValue(serverDB);

const ids = {
  admin: 'admin-detail-admin',
  alice: 'admin-detail-alice',
  bob: 'admin-detail-bob',
};

const ws1 = 'admin-detail-ws1';

const caller = () => adminConsoleRouter.createCaller({ userId: ids.admin } as never);

beforeEach(async () => {
  mocks.TopicModel.instances = [];
  mocks.createTerminalSession.mockReset();
  mocks.executeToolCall.mockReset();
  mocks.getDisplayInfoByIds.mockReset().mockResolvedValue([]);
  mocks.getLocalFilePreview.mockReset();
  mocks.listProjectDirectory.mockReset();
  mocks.loadDeviceBoundAgents.mockReset().mockResolvedValue([]);
  mocks.queryDeviceMetrics.mockReset().mockResolvedValue([]);
  mocks.queryDeviceSystemInfo.mockReset().mockResolvedValue(undefined);
  mocks.readTerminal.mockReset();
  mocks.resizeTerminal.mockReset();
  mocks.searchProjectFiles.mockReset();
  mocks.statPath.mockReset();
  mocks.writeTerminal.mockReset();
  mocks.getServerDB.mockResolvedValue(serverDB);

  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { email: 'admin@example.com', id: ids.admin, role: 'admin', username: 'admin' },
    { email: 'alice@example.com', id: ids.alice, username: 'alice' },
    { email: 'bob@example.com', id: ids.bob, username: 'bob' },
  ]);
  await serverDB.insert(workspaces).values({
    id: ws1,
    name: 'Alpha Team',
    primaryOwnerId: ids.alice,
    slug: 'alpha-team',
  });

  await serverDB.insert(devices).values([
    {
      defaultCwd: '/Users/alice/projects',
      deviceId: 'alice-laptop',
      hostname: 'alice-mac.local',
      identitySource: 'machine-id',
      lastSeenAt: new Date(),
      platform: 'darwin',
      userId: ids.alice,
      workingDirs: [{ path: '/Users/alice/work' }],
    },
    {
      deviceId: 'bob-laptop',
      hostname: 'bob-win.local',
      identitySource: 'machine-id',
      lastSeenAt: new Date(),
      platform: 'win32',
      userId: ids.bob,
    },
    {
      // Workspace enrollment: the row's identity is (workspaceId, deviceId)
      // and its owner column names the member who enrolled the machine.
      deviceId: 'ws-machine',
      hostname: 'team-linux.local',
      identitySource: 'machine-id',
      lastSeenAt: new Date(),
      platform: 'linux',
      userId: ids.alice,
      visibility: 'public',
      workspaceId: ws1,
    },
    {
      // Managed cloud devices have no gateway principal to ask.
      deviceId: 'managed-one',
      hostname: 'cloud-one',
      identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
      lastSeenAt: new Date(),
      platform: 'linux',
      userId: ids.alice,
    },
  ]);
});

describe('admin device detail — row identity vs read principal', () => {
  it('returns the owner’s working directories for a personal row', async () => {
    const result = await caller().getDeviceWorkingDirs({
      deviceId: 'alice-laptop',
      ownerId: ids.alice,
    });

    expect(result).toEqual({
      defaultCwd: '/Users/alice/projects',
      workingDirs: [{ path: '/Users/alice/work' }],
    });
  });

  it('refuses a personal row addressed with the wrong owner', async () => {
    await expect(
      caller().getDeviceWorkingDirs({ deviceId: 'alice-laptop', ownerId: ids.bob }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'DEVICE_NOT_FOUND' });
  });

  it('ignores a client-supplied ownerId on a workspace row and reads as the row owner', async () => {
    mocks.executeToolCall.mockResolvedValue({
      content: JSON.stringify({ agents: { 'claude-code': { available: true } } }),
      success: true,
    });

    const result = await caller().getDeviceAgents({
      deviceId: 'ws-machine',
      // A malicious / stale client claims the personal owner instead.
      ownerId: ids.bob,
      workspaceId: ws1,
    });

    expect(result.agents).toEqual({ 'claude-code': { available: true } });
    expect(mocks.executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'ws-machine', userId: ids.alice, workspaceId: ws1 }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('resolves activity under the owner’s principal, not the administrator’s', async () => {
    const result = await caller().getDeviceActivity({ deviceId: 'ws-machine', workspaceId: ws1 });

    expect(result).toEqual({ agents: [], runningTopics: [] });
    const topicModel = mocks.TopicModel.instances.at(-1);
    expect(topicModel).toMatchObject({ userId: ids.alice, workspaceId: ws1 });
    expect(mocks.loadDeviceBoundAgents).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'ws-machine',
        userId: ids.alice,
        workspaceId: ws1,
      }),
    );
  });
});

describe('admin device detail — managed cloud devices', () => {
  it('rejects gateway-backed reads for a managed device', async () => {
    await expect(
      caller().getDeviceOverview({ deviceId: 'managed-one', ownerId: ids.alice }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'MANAGED_DEVICE_UNSUPPORTED' });

    await expect(
      caller().getDeviceAgents({ deviceId: 'managed-one', ownerId: ids.alice }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('still serves database-only reads for a managed device', async () => {
    const result = await caller().getDeviceWorkingDirs({
      deviceId: 'managed-one',
      ownerId: ids.alice,
    });

    expect(result).toEqual({ defaultCwd: null, workingDirs: [] });
  });
});

describe('admin device detail — degradation', () => {
  it('answers an offline overview without throwing', async () => {
    mocks.queryDeviceSystemInfo.mockResolvedValue(undefined);
    mocks.queryDeviceMetrics.mockResolvedValue([]);

    const result = await caller().getDeviceOverview({
      deviceId: 'alice-laptop',
      ownerId: ids.alice,
    });

    expect(result.systemInfo).toBeNull();
    expect(result.metrics.points).toEqual([]);
    expect(mocks.queryDeviceSystemInfo).toHaveBeenCalledWith(ids.alice, 'alice-laptop', undefined);
  });

  it('returns null for a file read when the device does not answer', async () => {
    mocks.listProjectDirectory.mockResolvedValue(undefined);
    mocks.statPath.mockResolvedValue(undefined);

    await expect(
      caller().listProjectDirectory({
        deviceId: 'alice-laptop',
        ownerId: ids.alice,
        relativePath: 'src',
        root: '/Users/alice/projects',
      }),
    ).resolves.toBeNull();
    await expect(
      caller().statPath({ deviceId: 'alice-laptop', ownerId: ids.alice, path: '/tmp' }),
    ).resolves.toBeNull();
  });

  it('opens a terminal as the device owner, not as the admin', async () => {
    mocks.createTerminalSession.mockResolvedValue({ id: 'session-1' });

    await expect(
      caller().createTerminalSession({
        cols: 120,
        deviceId: 'alice-laptop',
        ownerId: ids.alice,
        rows: 30,
      }),
    ).resolves.toMatchObject({ id: 'session-1' });

    expect(mocks.createTerminalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cols: 120,
        deviceId: 'alice-laptop',
        rows: 30,
        userId: ids.alice,
      }),
    );
  });

  it('surfaces a terminal failure as BAD_GATEWAY with the device’s reason', async () => {
    mocks.readTerminal.mockRejectedValue(new Error('DEVICE_OFFLINE'));

    await expect(
      caller().readTerminal({
        cursor: 0,
        deviceId: 'alice-laptop',
        id: 'session-1',
        ownerId: ids.alice,
      }),
    ).rejects.toMatchObject({ code: 'BAD_GATEWAY', message: 'DEVICE_OFFLINE' });
  });

  it('roots a file preview at the device’s default working directory', async () => {
    mocks.getLocalFilePreview.mockResolvedValue({ success: false });

    await caller().getLocalFilePreview({
      deviceId: 'alice-laptop',
      ownerId: ids.alice,
      path: '/Users/alice/projects/README.md',
    });

    expect(mocks.getLocalFilePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'alice-laptop',
        userId: ids.alice,
        workingDirectory: '/Users/alice/projects',
      }),
    );
  });
});
