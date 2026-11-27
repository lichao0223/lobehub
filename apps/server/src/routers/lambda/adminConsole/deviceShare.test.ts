// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { devices, users, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { adminConsoleRouter } from './index';

const mocks = vi.hoisted(() => ({
  enrollWorkspace: vi.fn(),
  getServerDB: vi.fn(),
  unenrollWorkspace: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signWorkspaceDeviceToken: vi.fn(async () => 'workspace-token'),
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: {
    enrollWorkspace: mocks.enrollWorkspace,
    unenrollWorkspace: mocks.unenrollWorkspace,
  },
}));

const serverDB: LobeChatDatabase = await getTestDB();
mocks.getServerDB.mockResolvedValue(serverDB);

const ids = {
  admin: 'admin-share-admin',
  alice: 'admin-share-alice',
  workspace: 'admin-share-workspace',
};

const caller = () => adminConsoleRouter.createCaller({ userId: ids.admin } as never);

const target = { deviceId: 'alice-laptop', ownerId: ids.alice, workspaceId: ids.workspace };

const shareRow = async () =>
  serverDB.query.devices.findFirst({
    where: (row, { and, eq }) => and(eq(row.workspaceId, ids.workspace), eq(row.userId, ids.alice)),
  });

beforeEach(async () => {
  mocks.enrollWorkspace.mockReset();
  mocks.unenrollWorkspace.mockReset();
  mocks.enrollWorkspace.mockResolvedValue({
    identity: { deviceId: 'workspace-hash', identitySource: 'machine-id' },
    success: true,
  });
  mocks.unenrollWorkspace.mockResolvedValue({ success: true });

  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { email: 'admin@example.com', id: ids.admin, role: 'admin', username: 'admin' },
    { email: 'alice@example.com', id: ids.alice, username: 'alice' },
  ]);
  await serverDB.insert(workspaces).values({
    id: ids.workspace,
    name: 'Sharing Group',
    primaryOwnerId: ids.admin,
    slug: 'sharing-group',
  });
  await serverDB.insert(devices).values({
    deviceId: 'alice-laptop',
    hostname: 'laptop',
    identitySource: 'machine-id',
    platform: 'linux',
    userId: ids.alice,
  });
});

afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
});

describe('admin device shares', () => {
  it('shares a personal device into a workspace as a public admin share', async () => {
    const result = await caller().shareDeviceToWorkspace(target);

    expect(result).toMatchObject({ alreadyShared: false });
    expect(mocks.enrollWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'alice-laptop', userId: ids.alice }),
    );

    const row = await shareRow();
    expect(row).toMatchObject({
      visibility: 'public',
      shareOrigin: 'admin',
      sharedByUserId: ids.admin,
      sharedFromDeviceId: 'alice-laptop',
    });

    const shares = await caller().listDeviceShares(target);
    expect(shares).toEqual([
      { deviceId: 'workspace-hash', workspaceId: ids.workspace, workspaceName: 'Sharing Group' },
    ]);
  });

  it('is idempotent when the console already shared it', async () => {
    await caller().shareDeviceToWorkspace(target);
    const again = await caller().shareDeviceToWorkspace(target);

    expect(again).toMatchObject({ alreadyShared: true });
    expect(mocks.enrollWorkspace).toHaveBeenCalledTimes(1);
  });

  it('reports an offline device and writes nothing', async () => {
    mocks.enrollWorkspace.mockResolvedValue({ error: 'OFFLINE', success: false });

    await expect(caller().shareDeviceToWorkspace(target)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(await shareRow()).toBeUndefined();
  });

  it('refuses to overwrite a member-enrolled row', async () => {
    await serverDB.insert(devices).values({
      deviceId: 'workspace-hash',
      identitySource: 'machine-id',
      platform: 'linux',
      userId: ids.alice,
      visibility: 'public',
      workspaceId: ids.workspace,
    });

    await expect(caller().shareDeviceToWorkspace(target)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(mocks.unenrollWorkspace).toHaveBeenCalled();
  });

  it('revokes a console share and tells the device to leave the workspace', async () => {
    await caller().shareDeviceToWorkspace(target);
    await caller().revokeDeviceShare(target);

    expect(mocks.unenrollWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'workspace-hash', workspaceId: ids.workspace }),
    );
    expect(await shareRow()).toBeUndefined();
  });

  it('never revokes a share it does not own', async () => {
    await expect(caller().revokeDeviceShare(target)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'SHARE_NOT_FOUND',
    });
  });

  it('rejects a non-admin caller', async () => {
    const member = adminConsoleRouter.createCaller({ userId: ids.alice } as never);
    await expect(member.shareDeviceToWorkspace(target)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

// Keep the import used so lint does not drop it when assertions change.
void eq;
