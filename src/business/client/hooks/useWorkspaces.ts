import { useClientDataSWR } from '@/libs/swr';
import { workspaceService } from '@/services/workspace';

import type { WorkspaceListItem } from './useActiveWorkspace';

export const WORKSPACES_SWR_KEY = 'workspace-list';

type WorkspaceListRow = Awaited<ReturnType<typeof workspaceService.listWorkspaces>>[number];

/**
 * `workspace.list` returns the membership row: the stored workspace plus the
 * caller's role. Cloud tags a row with a plan string; the self-hosted build has
 * no plans, and `WorkspaceListItem` only models the three tags the UI knows, so
 * anything else is dropped instead of narrowing the server contract.
 */
const toWorkspaceListItem = (row: WorkspaceListRow): WorkspaceListItem => {
  const { plan, role, ...rest } = row;
  const item: WorkspaceListItem = { ...rest, role: role ?? undefined };

  if (plan === 'business' || plan === 'free' || plan === 'pro') item.plan = plan;

  return item;
};

/**
 * Workspaces the signed-in user is an active member of.
 *
 * Self-hosted deployments have no cloud workspace backend, but the admin
 * console does create real workspace / membership rows. Reading them through
 * `workspace.list` (membership-scoped) is what fills the device-share picker
 * and workspace-aware navigation; without it those surfaces stay empty.
 */
export const useWorkspaces = (): WorkspaceListItem[] => {
  const { data } = useClientDataSWR(WORKSPACES_SWR_KEY, () => workspaceService.listWorkspaces());

  return (data ?? []).map(toWorkspaceListItem);
};
