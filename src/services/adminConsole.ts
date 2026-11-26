import type {
  AdminConsoleAiConfigUpdate,
  AdminConsoleCatalogSyncResult,
  AdminConsoleConnectionTestResult,
  AdminConsoleLabsConfigUpdate,
  AdminConsoleLabsConfigView,
  AdminConsoleModelServiceConfig,
  AdminDeviceDetail,
  AdminDeviceListParams,
  AdminDeviceListResult,
  AdminDeviceStats,
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

  // ── Device overview (CUST-010) ────────────────────────────────────────────
  // Read-only: presence is resolved server-side per page, so `online` filters
  // after the SQL page and a page can come back shorter than `pageSize`.

  listDevices = async (params: AdminDeviceListParams = {}): Promise<AdminDeviceListResult> =>
    lambdaClient.adminConsole.listDevices.query(params);

  /** Read-only projection; filesystem paths are absent from the type by design. */
  getDevice = async (input: {
    deviceId: string;
    /** Owner of a personal row; ignored for workspace rows. */
    ownerId?: string | null;
    workspaceId?: string | null;
  }): Promise<AdminDeviceDetail> => lambdaClient.adminConsole.getDevice.query(input);

  /** Header counters, independent of the current filter; no gateway call. */
  getDeviceStats = async (): Promise<AdminDeviceStats> =>
    lambdaClient.adminConsole.getDeviceStats.query();
}

export const adminConsoleService = new AdminConsoleService();
