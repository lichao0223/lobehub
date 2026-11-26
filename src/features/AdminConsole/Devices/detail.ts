import type {
  AdminDeviceDetail,
  AdminDeviceOnlineState,
  AdminDeviceOwner,
  AdminDeviceScope,
  AdminDeviceVisibility,
  ManagedDevicePhase,
} from '@lobechat/types';

import { isTrpcErrorCode } from '@/utils/trpcError';

import { detailValue, deviceDisplayName, deviceSecondaryName } from './utils';

/**
 * The channel labels are owned by the upstream device settings namespace
 * (`packages/locales/src/default/setting.ts`, `devices.channel.*`) and are
 * already rendered by `@/features/DeviceManager`. Borrowing the strings keeps
 * the console copy identical to what the user sees on their own device page;
 * the keys are upstream-owned, so nothing here needs translating.
 */
export const CHANNEL_LABEL_KEYS = {
  connected: 'devices.channel.connected',
  unknown: 'devices.channel.unknown',
} as const;

/**
 * Managed cloud devices describe their own lifecycle in `managedPhase`. The
 * console keeps its own mapping instead of importing
 * `@/features/DeviceManager/managedDeviceStatus`: CUST-010 must not depend on
 * that feature (see `platform.tsx` for the same reasoning).
 */
export const MANAGED_PHASE_KEYS = {
  deleting: 'devices.detail.phase.deleting',
  failed: 'devices.detail.phase.failed',
  pending: 'devices.detail.phase.pending',
  running: 'devices.detail.phase.running',
  suspended: 'devices.detail.phase.suspended',
  suspending: 'devices.detail.phase.suspending',
  waking: 'devices.detail.phase.waking',
} as const satisfies Record<ManagedDevicePhase, string>;

export const MANAGED_PHASE_COLOR: Record<ManagedDevicePhase, string | undefined> = {
  deleting: undefined,
  failed: 'error',
  pending: 'warning',
  running: 'success',
  suspended: 'default',
  suspending: 'default',
  waking: 'warning',
};

export interface DeviceDetailChannelView {
  /** `null` on legacy gateways that omit the label; the view renders the unknown label. */
  channel: string | null;
  connectedAt: Date;
}

export interface DeviceDetailView {
  binding: {
    hasFixedAgentBinding: boolean;
  };
  connection: {
    channels: DeviceDetailChannelView[];
    managedPhase: ManagedDevicePhase | null;
    online: AdminDeviceOnlineState;
  };
  device: {
    /** Kept raw: it is composed into the platform label at render time. */
    architecture: string | null;
    deviceId: string;
    friendlyName: string;
    hostname: string;
    identitySource: string;
    name: string;
    /** Kept raw: drives the platform glyph. */
    platform: string | null;
    secondaryName: string;
  };
  ownership: {
    owner: AdminDeviceOwner;
    scope: AdminDeviceScope;
    sharedFromDeviceId: string | null;
    visibility: AdminDeviceVisibility | null;
    workspaceName: string | null;
  };
  timeline: {
    firstSeenAt: Date;
    lastSeenAt: Date;
  };
  version: {
    appVersion: string;
    cliVersion: string;
  };
}

/**
 * The admin privacy whitelist, as code.
 *
 * The drawer renders from this projection and from nothing else, so a column the
 * admin types deliberately exclude — `defaultCwd`, `workingDirs`, `recentCwds`,
 * or any `metadata` key outside `ADMIN_DEVICE_DETAIL_METADATA_KEYS` — has no
 * route into the DOM even if a response (or a future "just return the row"
 * refactor) carries it anyway. Values that render verbatim are normalized to
 * `—` here; the two raw fields are the ones that still need the device object.
 */
export const projectDeviceDetail = (device: AdminDeviceDetail): DeviceDetailView => ({
  binding: {
    hasFixedAgentBinding: Boolean(device.hasFixedAgentBinding),
  },
  connection: {
    channels: device.channels.map((channel) => ({
      channel: channel.channel ?? null,
      connectedAt: channel.connectedAt,
    })),
    managedPhase: device.managedPhase ?? null,
    online: device.online,
  },
  device: {
    architecture: device.architecture,
    deviceId: device.deviceId,
    friendlyName: detailValue(device.friendlyName),
    hostname: detailValue(device.hostname),
    identitySource: detailValue(device.identitySource),
    name: deviceDisplayName(device),
    platform: device.platform,
    secondaryName: deviceSecondaryName(device),
  },
  ownership: {
    owner: device.owner,
    scope: device.scope,
    sharedFromDeviceId: device.sharedFromDeviceId || null,
    visibility: device.visibility ?? null,
    workspaceName: device.workspace?.name ?? null,
  },
  timeline: {
    firstSeenAt: device.firstSeenAt,
    lastSeenAt: device.lastSeenAt,
  },
  version: {
    appVersion: detailValue(device.appVersion),
    cliVersion: detailValue(device.cliVersion),
  },
});

/**
 * The four error strings the drawer can show. Spelled as a literal union rather
 * than `string` so `t()` keeps its key checking: a typo here fails the type check
 * instead of rendering the raw key at runtime.
 */
export type DeviceLoadErrorKey =
  | 'devices.detail.loadFailed'
  | 'devices.detail.loadFailedDesc'
  | 'devices.detail.notFound.desc'
  | 'devices.detail.notFound.title';

export interface DeviceLoadErrorView {
  /** A deleted device is not retryable — the row is gone, not unreachable. */
  canRetry: boolean;
  descriptionKey: DeviceLoadErrorKey;
  notFound: boolean;
  titleKey: DeviceLoadErrorKey;
}

/** Keys, not strings: the caller keeps `t` and the active language. */
export const describeDeviceLoadError = (error: unknown): DeviceLoadErrorView =>
  isTrpcErrorCode(error, 'NOT_FOUND')
    ? {
        canRetry: false,
        descriptionKey: 'devices.detail.notFound.desc',
        notFound: true,
        titleKey: 'devices.detail.notFound.title',
      }
    : {
        canRetry: true,
        // The detail pane has its own copy: `devices.error.generic` says "the
        // device *list* could not load", which is wrong inside one device.
        descriptionKey: 'devices.detail.loadFailedDesc',
        notFound: false,
        titleKey: 'devices.detail.loadFailed',
      };
