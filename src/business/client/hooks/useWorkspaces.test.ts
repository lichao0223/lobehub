import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaces } from './useWorkspaces';

const { listWorkspaces } = vi.hoisted(() => ({ listWorkspaces: vi.fn() }));

vi.mock('@/services/workspace', () => ({ workspaceService: { listWorkspaces } }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
  useActiveWorkspaceId: () => null,
}));

/** A fresh SWR cache per test so one case can't seed the next. */
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

describe('useWorkspaces', () => {
  beforeEach(() => {
    listWorkspaces.mockReset();
  });

  it('returns [] while there is no data (a user without workspaces)', async () => {
    listWorkspaces.mockResolvedValue([]);

    const { result } = renderHook(() => useWorkspaces(), { wrapper });
    expect(result.current).toEqual([]);

    await waitFor(() => expect(listWorkspaces).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual([]);
  });

  it('returns the real workspace rows, role included', async () => {
    listWorkspaces.mockResolvedValue([
      { id: 'ws-1', name: 'Team A', role: 'member', slug: 'team-a' },
    ]);

    const { result } = renderHook(() => useWorkspaces(), { wrapper });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({ id: 'ws-1', name: 'Team A', role: 'member' });
  });

  it('keeps only the plan tags the UI models', async () => {
    listWorkspaces.mockResolvedValue([
      { id: 'ws-1', name: 'Team A', plan: 'pro', role: 'member', slug: 'team-a' },
      { id: 'ws-2', name: 'Team B', plan: 'enterprise', role: 'owner', slug: 'team-b' },
    ]);

    const { result } = renderHook(() => useWorkspaces(), { wrapper });

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0].plan).toBe('pro');
    expect(result.current[1]).not.toHaveProperty('plan');
  });
});
