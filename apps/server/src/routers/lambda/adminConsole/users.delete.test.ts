// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { adminConsoleSettings, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { adminConsoleRouter } from './index';

const mocks = vi.hoisted(() => ({
  deleteUserAccount: vi.fn(),
  getServerDB: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));
vi.mock('@/server/services/adminConsole/userDeletion', () => ({
  deleteUserAccount: mocks.deleteUserAccount,
}));

const serverDB: LobeChatDatabase = await getTestDB();
mocks.getServerDB.mockResolvedValue(serverDB);

const ids = {
  admin: 'admin-delete-router-admin',
  member: 'admin-delete-router-member',
};

const cleanup = async () => {
  await serverDB.delete(adminConsoleSettings).where(eq(adminConsoleSettings.id, 'singleton'));
  await serverDB.delete(users).where(inArray(users.id, Object.values(ids)));
};

beforeEach(async () => {
  await cleanup();
  mocks.deleteUserAccount.mockReset();
  mocks.deleteUserAccount.mockResolvedValue({ deletedFiles: 2, removedObjects: 1 });
  await serverDB.insert(users).values([
    { id: ids.admin, role: 'admin' },
    { id: ids.member, role: 'user' },
  ]);
});

afterEach(cleanup);

const callerFor = (userId?: string) => adminConsoleRouter.createCaller({ userId } as never);

describe('adminConsole.deleteUser', () => {
  it('keeps an anonymous call a 401', async () => {
    await expect(callerFor().deleteUser({ userId: ids.member })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(mocks.deleteUserAccount).not.toHaveBeenCalled();
  });

  it('answers a normal user with ADMIN_REQUIRED', async () => {
    await expect(callerFor(ids.member).deleteUser({ userId: ids.member })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'ADMIN_REQUIRED',
    });
    expect(mocks.deleteUserAccount).not.toHaveBeenCalled();
  });

  it('lets an admin delete and returns the storage summary', async () => {
    await expect(callerFor(ids.admin).deleteUser({ userId: ids.member })).resolves.toEqual({
      deletedFiles: 2,
      removedObjects: 1,
    });
    expect(mocks.deleteUserAccount).toHaveBeenCalledWith(serverDB, ids.admin, ids.member);
  });
});
