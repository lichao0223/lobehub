import type {
  AdminDeviceDetail,
  AdminDeviceListParams,
  AdminDeviceListResult,
  AdminDeviceStats,
} from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { adminConsoleService } from '@/services/adminConsole';

export const ADMIN_CONSOLE_DEVICES_KEY = 'admin-console-devices';
export const ADMIN_CONSOLE_DEVICE_KEY = 'admin-console-device';
export const ADMIN_CONSOLE_DEVICE_STATS_KEY = 'admin-console-device-stats';

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
