import type {
  AdminConsoleAiConfigUpdate,
  AdminConsoleCatalogSyncResult,
  AdminConsoleConnectionTestResult,
  AdminConsoleLabsConfigUpdate,
  AdminConsoleLabsConfigView,
  AdminConsoleModelServiceConfig,
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

  // ── Model service (CUST-008 §7) ───────────────────────────────────────────

  /** Never contains the key: the server reduces it to `last4`. */
  getModelServiceConfig = async (): Promise<AdminConsoleModelServiceConfig> =>
    lambdaClient.adminConsole.getModelServiceConfig.query();

  /** `apiKey` is plaintext on the wire and is never echoed back. */
  updateModelServiceConfig = async (
    input: AdminConsoleAiConfigUpdate,
  ): Promise<AdminConsoleModelServiceConfig> =>
    lambdaClient.adminConsole.updateModelServiceConfig.mutate(input);

  testModelServiceConnection = async (): Promise<AdminConsoleConnectionTestResult> =>
    lambdaClient.adminConsole.testModelServiceConnection.mutate();

  refreshModelCatalog = async (input: {
    apply: boolean;
    expectedUpdatedAt?: string;
  }): Promise<AdminConsoleCatalogSyncResult> =>
    lambdaClient.adminConsole.refreshModelCatalog.mutate(input);

  // ── Unified Labs switch (CUST-009) ────────────────────────────────────────

  getLabsConfig = async (): Promise<AdminConsoleLabsConfigView> =>
    lambdaClient.adminConsole.getLabsConfig.query();

  updateLabsConfig = async (
    input: AdminConsoleLabsConfigUpdate,
  ): Promise<AdminConsoleLabsConfigView> =>
    lambdaClient.adminConsole.updateLabsConfig.mutate(input);
}

export const adminConsoleService = new AdminConsoleService();
