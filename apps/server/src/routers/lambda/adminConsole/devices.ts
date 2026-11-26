import type {
  AdminDeviceChannel,
  AdminDeviceDetail,
  AdminDeviceListResult,
  AdminDeviceOnlineStats,
  AdminDeviceSummary,
} from '@lobechat/types';
import { ADMIN_DEVICE_MAX_PAGE_SIZE } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { adminProcedure } from '@/business/server/adminConsole/permissions';
import {
  type DeviceAttachment,
  deviceGateway,
  type DeviceListRead,
} from '@/server/services/deviceGateway';

const log = debug('lobe-server:admin-console-devices');

/**
 * Admin console device overview (CUST-010).
 *
 * A read-only inventory of every device in the deployment. The database layer
 * (`AdminConsoleModel`) owns *what* an administrator may see; this file owns the
 * one thing SQL cannot answer — live presence — and decorates each row with it.
 *
 * Presence contract (see `AdminDeviceOnlineState`):
 * - gateway not configured            → every row `unknown`, no request made
 * - principal probed, deviceId found  → `online`, `channelCount` = live channels
 * - principal probed, deviceId absent → `offline`
 * - probe failed / exceeded the budget→ `unknown`
 *
 * `unknown` is never folded into `offline`: "we could not ask" and "we asked and
 * it is gone" are different answers for an administrator.
 */

/** Concurrent gateway probes for one read. */
export const DEVICE_PROBE_CONCURRENCY = 5;

/** Whole-read probe budget; principals still running after it stay `unknown`. */
export const DEVICE_PROBE_TIMEOUT_MS = 3000;

const deviceListInput = z
  .object({
    online: z.enum(['offline', 'online', 'unknown']).optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(ADMIN_DEVICE_MAX_PAGE_SIZE).optional(),
    platform: z.string().trim().min(1).max(40).optional(),
    q: z.string().trim().max(100).optional(),
    scope: z.enum(['personal', 'workspace']).optional(),
    visibility: z.enum(['private', 'public']).optional(),
    workspaceId: z.string().trim().min(1).max(200).optional(),
  })
  .optional();

const deviceTargetInput = z.object({
  deviceId: z.string().trim().min(1).max(64),
  /**
   * Owner of a PERSONAL row. The personal pool is keyed by `(userId, deviceId)`
   * because `lh connect --device-id` can pin the same id for two owners, so the
   * console must pass the owner it rendered. Ignored for workspace rows, whose
   * identity is `(workspaceId, deviceId)`.
   */
  ownerId: z.string().trim().min(1).max(200).nullish(),
  workspaceId: z.string().trim().min(1).max(200).nullish(),
});

// ── presence ─────────────────────────────────────────────────────────────

/** One device pool, addressed by the gateway as a principal. */
export interface DevicePrincipal {
  userId: string;
  workspaceId: string | null;
}

const principalKey = (principal: DevicePrincipal) =>
  `${principal.userId}::${principal.workspaceId ?? ''}`;

/**
 * The principal behind a device row.
 *
 * `userId` comes from the owner join rather than the device row: a workspace
 * enrollment is identified by its workspace, but the gateway still needs a
 * user to address the pool. `undefined` when the owner join produced no user —
 * such a row can only be `unknown`, because there is nobody to ask.
 */
const principalOf = (
  device: Pick<AdminDeviceSummary, 'owner' | 'workspace'>,
): DevicePrincipal | undefined =>
  device.owner.userId
    ? { userId: device.owner.userId, workspaceId: device.workspace?.workspaceId ?? null }
    : undefined;

/** Outcome of probing one principal. `ok: false` means "presence unknown". */
export type DevicePrincipalProbe =
  { ok: true; devices: Map<string, DeviceAttachment> } | { ok: false };

/** Deduplicate a result page into the gateway principals it touches. */
export const collectPrincipals = (devices: AdminDeviceSummary[]): DevicePrincipal[] => {
  const seen = new Set<string>();
  const principals: DevicePrincipal[] = [];

  for (const device of devices) {
    const principal = principalOf(device);
    if (!principal) continue;

    const key = principalKey(principal);
    if (seen.has(key)) continue;

    seen.add(key);
    principals.push(principal);
  }

  return principals;
};

/**
 * Live connections of one device. The gateway dedupes to one entry per device
 * with its connections nested, so a legacy flat answer still means "one".
 */
const channelCountOf = (device: DeviceAttachment) => Math.max(1, device.channels?.length ?? 0);

/**
 * Apply probe results to a page of rows.
 *
 * Kept free of I/O and clocks so the presence rules can be asserted directly.
 */
export const resolveOnlineStates = (
  devices: AdminDeviceSummary[],
  probes: Map<string, DevicePrincipalProbe>,
): AdminDeviceSummary[] =>
  devices.map((device): AdminDeviceSummary => {
    const principal = principalOf(device);
    const probe = principal ? probes.get(principalKey(principal)) : undefined;

    if (!probe?.ok) return { ...device, channelCount: 0, online: 'unknown' };

    const live = probe.devices.get(device.deviceId);
    if (!live) return { ...device, channelCount: 0, online: 'offline' };

    return { ...device, channelCount: channelCountOf(live), online: 'online' };
  });

/** Presence tally of a page; `onlineStats` describes exactly the rows returned. */
export const tallyOnline = (
  devices: Pick<AdminDeviceSummary, 'online'>[],
): AdminDeviceOnlineStats => {
  const stats: AdminDeviceOnlineStats = { offline: 0, online: 0, unknown: 0 };
  for (const device of devices) stats[device.online] += 1;
  return stats;
};

type DeviceListReader = (principal: DevicePrincipal) => Promise<DeviceListRead>;

/**
 * Read one principal's pool through the failure-aware gateway method.
 *
 * `deviceGateway.queryDeviceList` answers `[]` when the gateway does not
 * answer, which this page would render as "every device of this user is
 * offline". `readDeviceList` reports the failure instead, so the rows stay
 * `unknown`.
 */
const readPrincipalDevices: DeviceListReader = (principal) =>
  deviceGateway.readDeviceList(principal.userId, principal.workspaceId ?? undefined);

/**
 * Probe every principal, bounded in concurrency and in total time.
 *
 * `Promise.race` stops the caller waiting; it cannot cancel a request already
 * in flight. Results that arrive after the budget are dropped instead of
 * mutating the map the caller already read, and a principal with no entry stays
 * `unknown` downstream.
 */
export const probePrincipals = async (
  principals: DevicePrincipal[],
  options: {
    concurrency?: number;
    configured?: boolean;
    read?: DeviceListReader;
    timeoutMs?: number;
  } = {},
): Promise<Map<string, DevicePrincipalProbe>> => {
  const {
    concurrency = DEVICE_PROBE_CONCURRENCY,
    configured = deviceGateway.isConfigured,
    read = readPrincipalDevices,
    timeoutMs = DEVICE_PROBE_TIMEOUT_MS,
  } = options;

  const probes = new Map<string, DevicePrincipalProbe>();
  // No gateway, no requests: every row stays `unknown` by construction.
  if (!configured || principals.length === 0) return probes;

  let accepting = true;
  const probeOne = async (principal: DevicePrincipal) => {
    const key = principalKey(principal);

    try {
      const result = await read(principal);
      if (!accepting) return;

      if (!result.ok) {
        log('presence probe unreadable for %o: %s', principal, result.reason);
        probes.set(key, { ok: false });
        return;
      }

      probes.set(key, {
        devices: new Map(result.devices.map((device) => [device.deviceId, device])),
        ok: true,
      });
    } catch (error) {
      log('presence probe failed for %o: %O', principal, error);
      if (accepting) probes.set(key, { ok: false });
    }
  };

  const queue = [...principals];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const principal = queue.shift();
      if (!principal) return;
      await probeOne(principal);
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      log(
        'presence budget of %dms exhausted; %d principal(s) stay unknown',
        timeoutMs,
        queue.length,
      );
      resolve();
    }, timeoutMs);
  });

  try {
    await Promise.race([Promise.all(workers).then(() => undefined), deadline]);
  } finally {
    accepting = false;
    clearTimeout(timer);
  }

  return new Map(probes);
};

const decoratePage = async (devices: AdminDeviceSummary[]) =>
  resolveOnlineStates(devices, await probePrincipals(collectPrincipals(devices)));

/**
 * Attach live state to one detail row. Channels are the reason detail needs the
 * raw probe: the list only counts them.
 */
const decorateDetail = async (device: AdminDeviceDetail): Promise<AdminDeviceDetail> => {
  const principal = principalOf(device);
  const probe = principal
    ? (await probePrincipals([principal])).get(principalKey(principal))
    : undefined;

  if (!probe?.ok) return { ...device, channelCount: 0, channels: [], online: 'unknown' };

  const live = probe.devices.get(device.deviceId);
  if (!live) return { ...device, channelCount: 0, channels: [], online: 'offline' };

  // A gateway that predates nested `channels` reports only `lastSeen`; surface
  // that one connection instead of an "online with no channel" contradiction.
  const channels: AdminDeviceChannel[] =
    live.channels && live.channels.length > 0
      ? live.channels.map((channel) => ({
          channel: channel.channel ?? null,
          connectedAt: new Date(channel.connectedAt),
        }))
      : [{ channel: null, connectedAt: new Date(live.lastSeen) }];

  return { ...device, channelCount: channels.length, channels, online: 'online' };
};

// ── procedures ───────────────────────────────────────────────────────────

export const adminDeviceProcedures = {
  listDevices: adminProcedure.input(deviceListInput).query(async ({ ctx, input }) => {
    const result = await ctx.adminModel.listDevices(input ?? {});
    const decorated = await decoratePage(result.items);

    // Presence is live state, so `online` cannot narrow the SQL page: it is
    // applied here, which means a page can come back short (or empty) while
    // `total` still counts every row matching the SQL filters.
    const items = input?.online
      ? decorated.filter((item) => item.online === input.online)
      : decorated;

    return { ...result, items, onlineStats: tallyOnline(items) } satisfies AdminDeviceListResult;
  }),

  getDevice: adminProcedure.input(deviceTargetInput).query(async ({ ctx, input }) => {
    const device = await ctx.adminModel.getDevice(input.deviceId, {
      ownerId: input.ownerId ?? undefined,
      workspaceId: input.workspaceId ?? null,
    });

    if (!device) throw new TRPCError({ code: 'NOT_FOUND', message: 'DEVICE_NOT_FOUND' });

    return decorateDetail(device);
  }),

  /** Header counters; presence is not part of them, so no gateway call. */
  getDeviceStats: adminProcedure.query(({ ctx }) => ctx.adminModel.getDeviceStats()),
};
