import type {
  AdminDeviceDetail,
  AdminDeviceListParams,
  AdminDeviceListResult,
  AdminDeviceStats,
  AdminDeviceTarget,
} from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { adminConsoleService } from '@/services/adminConsole';

export const ADMIN_CONSOLE_DEVICES_KEY = 'admin-console-devices';
export const ADMIN_CONSOLE_DEVICE_KEY = 'admin-console-device';
export const ADMIN_CONSOLE_DEVICE_STATS_KEY = 'admin-console-device-stats';
export const ADMIN_CONSOLE_DEVICE_OVERVIEW_KEY = 'admin-console-device-overview';
export const ADMIN_CONSOLE_DEVICE_ACTIVITY_KEY = 'admin-console-device-activity';
export const ADMIN_CONSOLE_DEVICE_AGENTS_KEY = 'admin-console-device-agents';
export const ADMIN_CONSOLE_DEVICE_FILES_KEY = 'admin-console-device-files';
export const ADMIN_CONSOLE_DEVICE_SHARES_KEY = 'admin-console-device-shares';

export const useAdminDevices = (params: AdminDeviceListParams) =>
  useClientDataSWR<AdminDeviceListResult>([ADMIN_CONSOLE_DEVICES_KEY, params], () =>
    adminConsoleService.listDevices(params),
  );

/**
 * One device addressed by its owning row: `(workspaceId, deviceId)` for a
 * workspace enrollment, `(ownerId, deviceId)` for a personal one.
 *
 * The id alone is ambiguous both ways round — two pools can share it, and so
 * can two owners — so both parts belong in the cache key as well as the
 * request. `workspaceId === null` means "a personal row".
 */
export const useAdminDevice = (
  deviceId: string | null,
  workspaceId: string | null,
  ownerId: string | null,
) =>
  useClientDataSWR<AdminDeviceDetail>(
    deviceId ? [ADMIN_CONSOLE_DEVICE_KEY, deviceId, workspaceId, ownerId] : null,
    () => adminConsoleService.getDevice({ deviceId: deviceId!, ownerId, workspaceId }),
  );

/**
 * Header counters. Deliberately not keyed by the list params: these totals
 * describe the whole deployment, so filtering the list must not change them.
 */
export const useAdminDeviceStats = () =>
  useClientDataSWR<AdminDeviceStats>([ADMIN_CONSOLE_DEVICE_STATS_KEY], () =>
    adminConsoleService.getDeviceStats(),
  );

const targetKey = (key: string, target: AdminDeviceTarget) => [
  key,
  target.deviceId,
  target.workspaceId ?? null,
  target.ownerId ?? null,
];

/** System info + metric series for the detail overview. */
export const useAdminDeviceOverview = (target: AdminDeviceTarget | null) =>
  useClientDataSWR(target ? targetKey(ADMIN_CONSOLE_DEVICE_OVERVIEW_KEY, target) : null, () =>
    adminConsoleService.getDeviceOverview(target!),
  );

/** Running topics + agents routed to the device. */
export const useAdminDeviceActivity = (target: AdminDeviceTarget | null) =>
  useClientDataSWR(target ? targetKey(ADMIN_CONSOLE_DEVICE_ACTIVITY_KEY, target) : null, () =>
    adminConsoleService.getDeviceActivity(target!),
  );

/** Installed heterogeneous runtimes, scanned over the device connection. */
export const useAdminDeviceAgents = (target: AdminDeviceTarget | null) =>
  useClientDataSWR(target ? targetKey(ADMIN_CONSOLE_DEVICE_AGENTS_KEY, target) : null, () =>
    adminConsoleService.getDeviceAgents(target!),
  );

/** Children of one project directory, read-only. */
export const useAdminProjectDirectory = (
  target: (AdminDeviceTarget & { relativePath: string; root: string }) | null,
) =>
  useClientDataSWR(
    target
      ? [...targetKey(ADMIN_CONSOLE_DEVICE_FILES_KEY, target), target.root, target.relativePath]
      : null,
    () => adminConsoleService.listProjectDirectory(target!),
  );

/** Workspaces this personal device is shared into from the console. */
export const useAdminDeviceShares = (target: AdminDeviceTarget | null) =>
  useClientDataSWR(target ? targetKey(ADMIN_CONSOLE_DEVICE_SHARES_KEY, target) : null, () =>
    adminConsoleService.listDeviceShares(target!),
  );
