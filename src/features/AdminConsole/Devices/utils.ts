import type {
  AdminDeviceListParams,
  AdminDeviceOnlineState,
  AdminDeviceScope,
  AdminDeviceSummary,
  AdminDeviceVisibility,
} from '@lobechat/types';
import dayjs from 'dayjs';

export const PAGE_SIZE = 20;

export type ScopeFilter = 'all' | AdminDeviceScope;
export type OnlineFilter = 'all' | AdminDeviceOnlineState;
export type VisibilityFilter = 'all' | AdminDeviceVisibility;

export interface DeviceFilterState {
  keyword: string;
  online: OnlineFilter;
  page: number;
  scope: ScopeFilter;
  visibility: VisibilityFilter;
}

export const DEFAULT_DEVICE_FILTERS: DeviceFilterState = {
  keyword: '',
  online: 'all',
  page: 1,
  scope: 'all',
  visibility: 'all',
};

/**
 * Turn the toolbar state into a request.
 *
 * Visibility only exists on workspace rows, so it is dropped unless the scope is
 * explicitly `workspace`: sending it under `personal` (or `all`) would either be
 * ignored server-side or silently hide every personal device, and a filter that
 * looks applied but is not is worse than no filter.
 */
export const buildDeviceListParams = (filters: DeviceFilterState): AdminDeviceListParams => {
  const keyword = filters.keyword.trim();

  return {
    online: filters.online === 'all' ? undefined : filters.online,
    page: filters.page,
    pageSize: PAGE_SIZE,
    q: keyword || undefined,
    scope: filters.scope === 'all' ? undefined : filters.scope,
    visibility:
      filters.scope === 'workspace' && filters.visibility !== 'all'
        ? filters.visibility
        : undefined,
  };
};

export const hasActiveDeviceFilters = (filters: DeviceFilterState) =>
  Boolean(filters.keyword.trim()) ||
  filters.scope !== 'all' ||
  filters.online !== 'all' ||
  filters.visibility !== 'all';

/**
 * Presence is applied AFTER the SQL page (the server checks the gateway live), so
 * an `online` filter can leave the returned page shorter than `pageSize` while
 * `total` still counts every row matching the SQL filters. The page says so
 * instead of looking like a broken last page.
 */
export const isDevicePagePartial = (
  filters: DeviceFilterState,
  shown: number,
  total: number,
): boolean =>
  Boolean(filters.online && filters.online !== 'all') && shown < Math.min(PAGE_SIZE, total);

/** Every absent value renders as this, never as `null` / `undefined`. */
export const EMPTY_VALUE = '—';

export const detailValue = (value: string | null | undefined) => value || EMPTY_VALUE;

export const formatRelative = (value: Date | string | null | undefined) =>
  value ? dayjs(value).fromNow() : EMPTY_VALUE;

export const formatAbsolute = (value: Date | string | null | undefined) =>
  value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : EMPTY_VALUE;

/**
 * A device's display name. `friendlyName` is what the user renamed it to, so the
 * rename wins over the machine's own `hostname`; `deviceId` is the last resort so
 * a row always renders something identifiable.
 */
export const deviceDisplayName = (
  device: Pick<AdminDeviceSummary, 'deviceId' | 'friendlyName' | 'hostname'>,
) => device.friendlyName || device.hostname || device.deviceId;

/** Secondary line under the name: hostname when renamed, else the device id. */
export const deviceSecondaryName = (
  device: Pick<AdminDeviceSummary, 'deviceId' | 'friendlyName' | 'hostname'>,
) => (device.friendlyName && device.hostname ? device.hostname : device.deviceId);

export const ownerDisplayName = (owner: AdminDeviceSummary['owner']) =>
  owner.fullName || owner.username || owner.email || '—';

export const ownerSecondaryName = (owner: AdminDeviceSummary['owner']) =>
  owner.email ?? (owner.username ? `@${owner.username}` : '—');

/**
 * A row's identity, matching the database's unique key: `(workspaceId,
 * deviceId)` for workspace enrollments, `(userId, deviceId)` for personal rows.
 *
 * `deviceId` alone is not unique — it normally hashes in the principal, but
 * `lh connect --device-id` pins an explicit id, so two owners can legitimately
 * hold the same one. Keying personal rows by a fixed `personal` placeholder
 * collapsed them into one React key (and one cache entry).
 */
export const deviceRowKey = (device: AdminDeviceSummary) =>
  device.workspace
    ? `${device.workspace.workspaceId}::${device.deviceId}`
    : `personal:${device.owner.userId}::${device.deviceId}`;

/**
 * What the drawer needs to open a row: the pool that owns it plus the id.
 *
 * The id alone is ambiguous in both directions — a workspace enrollment and a
 * personal device can share it, and so can two owners' personal devices — so
 * the drawer is addressed by the same pair the row is.
 */
export interface DeviceSelection {
  deviceId: string;
  /** Owner of a personal row; `null` for workspace rows (they have no owner key). */
  ownerId: string | null;
  workspaceId: string | null;
}

export const deviceSelection = (device: AdminDeviceSummary): DeviceSelection => ({
  deviceId: device.deviceId,
  ownerId: device.workspace ? null : device.owner.userId || null,
  workspaceId: device.workspace?.workspaceId ?? null,
});
