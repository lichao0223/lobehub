// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { users, workspaceMembers, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { createCallerFactory } from '@/libs/trpc/lambda';

import { workspaceRouter } from './workspace';

// The self-hosted build has no cloud DB layer: the procedure resolves the
// server connection through `getServerDB`, so the test points that at the
// migrated PGlite instance and then exercises the real membership query.
vi.mock('@/database/core/db-adaptor', async () => {
  const { getTestDB: openTestDB } = await import('@/database/core/getTestDB');
  return { getServerDB: () => openTestDB() };
});

const createCaller = createCallerFactory(workspaceRouter);

const ownerId = 'ws-router-owner';
const memberId = 'ws-router-member';
const removedId = 'ws-router-removed';
const outsiderId = 'ws-router-outsider';

const userIds = [ownerId, memberId, removedId, outsiderId];
const workspaceIds = ['ws-router-a', 'ws-router-b'];

// Opened once, outside the hooks: the first call runs every migration, which
// is far longer than a Vitest hook timeout.
const serverDB: LobeChatDatabase = await getTestDB();

const cleanup = async () => {
  await serverDB
    .delete(workspaceMembers)
    .where(inArray(workspaceMembers.workspaceId, workspaceIds));
  await serverDB.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
  await serverDB.delete(users).where(inArray(users.id, userIds));
};

const listAs = (userId: string) => createCaller({ userId } as never).list();

beforeEach(async () => {
  await cleanup();

  await serverDB.insert(users).values(
    userIds.map((id) => ({
      email: `${id}@example.com`,
      id,
      username: id,
    })),
  );

  await serverDB.insert(workspaces).values([
    { id: 'ws-router-a', name: 'Team A', primaryOwnerId: ownerId, slug: 'team-a' },
    { id: 'ws-router-b', name: 'Team B', primaryOwnerId: ownerId, slug: 'team-b' },
  ]);

  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId: 'ws-router-a' },
    { role: 'member', userId: memberId, workspaceId: 'ws-router-a' },
    // Soft-removed: the row is still there, the member must not see it.
    { deletedAt: new Date(), role: 'member', userId: removedId, workspaceId: 'ws-router-a' },
    { role: 'owner', userId: ownerId, workspaceId: 'ws-router-b' },
    { role: 'admin', userId: memberId, workspaceId: 'ws-router-b' },
  ]);
});

afterEach(async () => {
  await cleanup();
});

describe('workspace.list (self-hosted)', () => {
  it('returns every workspace the caller is an active member of, with their role', async () => {
    const list = await listAs(memberId);

    expect(list).toHaveLength(2);
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ws-router-a',
          name: 'Team A',
          role: 'member',
          slug: 'team-a',
        }),
        expect.objectContaining({
          id: 'ws-router-b',
          name: 'Team B',
          role: 'admin',
          slug: 'team-b',
        }),
      ]),
    );
  });

  it('does not leak workspaces the caller never joined', async () => {
    // `outsider` holds no membership row at all and `removed` only a
    // soft-deleted one, so neither sees Team A or Team B.
    await expect(listAs(outsiderId)).resolves.toEqual([]);
    await expect(listAs(removedId)).resolves.toEqual([]);
  });

  it('hides a workspace once the membership is soft-deleted', async () => {
    await expect(listAs(memberId)).resolves.toHaveLength(2);

    await serverDB
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(inArray(workspaceMembers.userId, [memberId]));

    await expect(listAs(memberId)).resolves.toEqual([]);
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(createCaller({ userId: null } as never).list()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
