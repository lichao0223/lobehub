// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { adminConsoleRouter } from './index';

const mocks = vi.hoisted(() => ({ getServerDB: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mocks.getServerDB }));

const serverDB: LobeChatDatabase = await getTestDB();
mocks.getServerDB.mockResolvedValue(serverDB);

const ids = {
  admin: 'admin-workspaces-admin',
  alice: 'admin-workspaces-alice',
  bob: 'admin-workspaces-bob',
};

const callerFor = (userId?: string) => adminConsoleRouter.createCaller({ userId } as never);
const admin = () => callerFor(ids.admin);

beforeEach(async () => {
  mocks.getServerDB.mockResolvedValue(serverDB);
  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { email: 'admin@example.com', id: ids.admin, role: 'admin', username: 'admin' },
    { email: 'alice@example.com', fullName: 'Alice Zhang', id: ids.alice, username: 'alice' },
    { email: 'bob@example.com', id: ids.bob, username: 'bob' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('admin workspace management', () => {
  it('rejects a normal user', async () => {
    await expect(callerFor(ids.alice).listWorkspaces()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'ADMIN_REQUIRED',
    });
  });

  it('creates a workspace with the admin as owner, then lists it with counters', async () => {
    const created = await admin().createWorkspace({ name: 'Growth Team' });

    expect(created.slug).toBe('growth-team');

    const result = await admin().listWorkspaces({ q: 'Growth' });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      deviceCount: 0,
      id: created.id,
      memberCount: 1,
      name: 'Growth Team',
    });

    const members = await admin().listWorkspaceMembers({ workspaceId: created.id });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ role: 'owner', userId: ids.admin });
  });

  it('adds a member by email and refuses duplicates', async () => {
    const created = await admin().createWorkspace({ name: 'Ops Team' });

    await expect(
      admin().addWorkspaceMember({
        identity: 'alice@example.com',
        role: 'member',
        workspaceId: created.id,
      }),
    ).resolves.toMatchObject({ userId: ids.alice });

    await expect(
      admin().addWorkspaceMember({
        identity: 'alice',
        role: 'member',
        workspaceId: created.id,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'ALREADY_A_MEMBER' });

    await expect(
      admin().addWorkspaceMember({
        identity: 'nobody@example.com',
        role: 'member',
        workspaceId: created.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'USER_NOT_FOUND' });

    const members = await admin().listWorkspaceMembers({ workspaceId: created.id });
    expect(members.map((member) => member.userId).sort()).toEqual([ids.admin, ids.alice].sort());
  });

  it('treats the owner as read-only: no demotion, no removal', async () => {
    const created = await admin().createWorkspace({ name: 'Solo Team' });

    await expect(
      admin().updateWorkspaceMemberRole({
        role: 'member',
        userId: ids.admin,
        workspaceId: created.id,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'OWNER_ROLE_IMMUTABLE' });

    await expect(
      admin().removeWorkspaceMember({ userId: ids.admin, workspaceId: created.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'OWNER_CANNOT_BE_REMOVED' });
  });

  it('promotes a member to admin and removes them', async () => {
    const created = await admin().createWorkspace({ name: 'Handover Team' });
    await admin().addWorkspaceMember({
      identity: 'bob',
      role: 'member',
      workspaceId: created.id,
    });

    await admin().updateWorkspaceMemberRole({
      role: 'admin',
      userId: ids.bob,
      workspaceId: created.id,
    });

    let members = await admin().listWorkspaceMembers({ workspaceId: created.id });
    expect(members.find((member) => member.userId === ids.bob)?.role).toBe('admin');

    await expect(
      admin().removeWorkspaceMember({ userId: ids.bob, workspaceId: created.id }),
    ).resolves.toMatchObject({ success: true });

    members = await admin().listWorkspaceMembers({ workspaceId: created.id });
    expect(members.map((member) => member.userId)).toEqual([ids.admin]);
  });
});
