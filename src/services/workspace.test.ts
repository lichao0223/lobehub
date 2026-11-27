import { describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { workspace: { list: { query } } },
}));

const { workspaceService } = await import('./workspace');

describe('workspaceService', () => {
  it('lists workspaces through the membership-scoped workspace.list query', async () => {
    const rows = [
      { id: 'ws-1', name: 'Team A', role: 'member', slug: 'team-a' },
      { id: 'ws-2', name: 'Team B', role: 'owner', slug: 'team-b' },
    ];
    query.mockResolvedValueOnce(rows);

    await expect(workspaceService.listWorkspaces()).resolves.toEqual(rows);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
