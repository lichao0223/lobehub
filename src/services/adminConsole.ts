import type {
  AdminRole,
  AdminUserDetail,
  AdminUserListParams,
  AdminUserListResult,
  AdminWhoamiResult,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class AdminConsoleService {
  whoami = async (): Promise<AdminWhoamiResult> => lambdaClient.adminConsole.whoami.query();

  listUsers = async (params: AdminUserListParams = {}): Promise<AdminUserListResult> =>
    lambdaClient.adminConsole.listUsers.query(params);

  getUser = async (userId: string): Promise<AdminUserDetail> =>
    lambdaClient.adminConsole.getUser.query({ userId });

  setUserRole = async (userId: string, role: AdminRole) =>
    lambdaClient.adminConsole.setUserRole.mutate({ role, userId });

  banUser = async (userId: string, reason: string, expiresAt?: Date) =>
    lambdaClient.adminConsole.banUser.mutate({ expiresAt, reason, userId });

  unbanUser = async (userId: string) => lambdaClient.adminConsole.unbanUser.mutate({ userId });

  revokeUserSessions = async (userId: string) =>
    lambdaClient.adminConsole.revokeUserSessions.mutate({ userId });
}

export const adminConsoleService = new AdminConsoleService();
