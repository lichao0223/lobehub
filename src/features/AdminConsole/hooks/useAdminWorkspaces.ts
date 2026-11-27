import { useClientDataSWR } from '@/libs/swr';
import { adminConsoleService } from '@/services/adminConsole';

export const ADMIN_CONSOLE_WORKSPACES_KEY = 'admin-console-workspaces';
export const ADMIN_CONSOLE_WORKSPACE_MEMBERS_KEY = 'admin-console-workspace-members';

export const useAdminWorkspaces = (params: { page?: number; q?: string }) =>
  useClientDataSWR([ADMIN_CONSOLE_WORKSPACES_KEY, params.page ?? 1, params.q ?? ''], () =>
    adminConsoleService.listWorkspaces(params),
  );

export const useAdminWorkspaceMembers = (workspaceId: string | null) =>
  useClientDataSWR(workspaceId ? [ADMIN_CONSOLE_WORKSPACE_MEMBERS_KEY, workspaceId] : null, () =>
    adminConsoleService.listWorkspaceMembers(workspaceId!),
  );
