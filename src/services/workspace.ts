import { lambdaClient } from '@/libs/trpc/client';

class WorkspaceService {
  /**
   * Workspaces the signed-in user holds a live membership in, newest-updated
   * first, each carrying the caller's membership role.
   */
  listWorkspaces = () => lambdaClient.workspace.list.query();
}

export const workspaceService = new WorkspaceService();
