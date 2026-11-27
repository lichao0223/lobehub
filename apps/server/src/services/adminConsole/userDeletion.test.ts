// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { serverDBEnv } from '@/config/db';
import { getTestDB } from '@/database/core/getTestDB';
import { files, globalFiles } from '@/database/schemas/file';
import { users } from '@/database/schemas/user';
import type { LobeChatDatabase } from '@/database/type';
import { deleteUserAccount } from '@/server/services/adminConsole/userDeletion';

const mocks = vi.hoisted(() => ({ deleteFiles: vi.fn() }));

vi.mock('@/server/services/file', () => ({
  FileService: class {
    deleteFiles = mocks.deleteFiles;
  },
}));

const serverDB: LobeChatDatabase = await getTestDB();

const ids = {
  actor: 'admin-purge-actor',
  member: 'admin-purge-member',
  other: 'admin-purge-other',
};

const cleanup = async () => {
  await serverDB.delete(files).where(inArray(files.userId, Object.values(ids)));
  await serverDB
    .delete(globalFiles)
    .where(inArray(globalFiles.hashId, ['purge-shared', 'purge-own']));
  await serverDB.delete(users).where(inArray(users.id, Object.values(ids)));
};

beforeEach(async () => {
  await cleanup();
  mocks.deleteFiles.mockReset();
  mocks.deleteFiles.mockResolvedValue(undefined);

  await serverDB.insert(users).values([
    { id: ids.actor, role: 'admin' },
    { id: ids.member, role: 'user' },
    { id: ids.other, role: 'user' },
  ]);

  await serverDB.insert(globalFiles).values([
    {
      creator: ids.member,
      fileType: 'image/png',
      hashId: 'purge-shared',
      size: 1,
      url: 's3://shared',
    },
    { creator: ids.member, fileType: 'image/png', hashId: 'purge-own', size: 1, url: 's3://own' },
  ]);

  await serverDB.insert(files).values([
    {
      fileHash: 'purge-shared',
      fileType: 'image/png',
      id: 'purge-file-shared',
      name: 'a.png',
      size: 1,
      url: 's3://shared',
      userId: ids.member,
    },
    {
      fileHash: 'purge-shared',
      fileType: 'image/png',
      id: 'purge-file-other',
      name: 'b.png',
      size: 1,
      url: 's3://shared',
      userId: ids.other,
    },
    {
      fileHash: 'purge-own',
      fileType: 'image/png',
      id: 'purge-file-own',
      name: 'c.png',
      size: 1,
      url: 's3://own',
      userId: ids.member,
    },
    {
      fileType: 'image/png',
      id: 'purge-file-orphan',
      name: 'd.png',
      size: 1,
      url: 's3://orphan',
      userId: ids.member,
    },
  ]);
});

afterEach(cleanup);

describe('deleteUserAccount storage purge', () => {
  it('deletes the account and reclaims only objects no other account references', async () => {
    expect(serverDBEnv.REMOVE_GLOBAL_FILE).toBe(true);

    const result = await deleteUserAccount(serverDB, ids.actor, ids.member);

    expect(result).toEqual({ deletedFiles: 3, removedObjects: 2 });
    expect(mocks.deleteFiles).toHaveBeenCalledWith(
      expect.arrayContaining(['s3://own', 's3://orphan']),
    );
    expect(mocks.deleteFiles.mock.calls[0][0]).not.toContain('s3://shared');

    // The member is physically gone; the other account and its file survive.
    await expect(
      serverDB.select({ id: users.id }).from(users).where(eq(users.id, ids.member)),
    ).resolves.toHaveLength(0);
    await expect(
      serverDB.select({ id: files.id }).from(files).where(eq(files.id, 'purge-file-other')),
    ).resolves.toHaveLength(1);

    // The shared dedupe row is kept for the remaining account; the exclusive one is not.
    const remainingHashes = await serverDB.select({ hashId: globalFiles.hashId }).from(globalFiles);
    expect(remainingHashes.map((row) => row.hashId)).toEqual(['purge-shared']);
  });

  it('stores nothing from the guards: an admin target never reaches storage cleanup', async () => {
    await expect(deleteUserAccount(serverDB, ids.actor, ids.actor)).rejects.toMatchObject({
      message: 'SELF_LOCKOUT',
    });
    expect(mocks.deleteFiles).not.toHaveBeenCalled();
  });
});
