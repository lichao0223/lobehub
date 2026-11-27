import type { AdminConsoleModel } from '@lobechat/database';
import type { HeterogeneousAgentScanMap } from '@lobechat/heterogeneous-agents';
import type { AdminDeviceDetail } from '@lobechat/types';
import { isManagedCloudDevice } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { adminProcedure } from '@/business/server/adminConsole/permissions';
import { TopicModel } from '@/database/models/topic';
import { deviceGateway } from '@/server/services/deviceGateway';

import { loadTopicUsers, resolveRunUserIds } from '../device/activityShared';
import { buildDeviceMetricSeries } from '../device/metricSeries';
import { loadDeviceBoundAgents } from '../deviceBoundAgents';

/**
 * Admin device DETAIL (CUST-010 P2).
 *
 * The personal `/settings/devices/:id` page reads everything as
 * `ctx.userId` / `ctx.workspaceId`. The console must show the same page for a
 * machine owned by someone else, so every read below is rebuilt around the
 * OWNER as the principal, resolved from the device row the administrator
 * addressed — never from a client-supplied owner.
 *
 * Two rules make that safe:
 * 1. Identity, not authority. `{ deviceId, ownerId?, workspaceId? }` names the
 *    row (the same pair its unique index enforces); the row is then resolved
 *    server-side and the gateway/model call receives `row.owner.userId` and
 *    `row.workspace?.workspaceId`. A client cannot point a read at a principal
 *    the row does not belong to.
 * 2. Live reads need the device to answer. `managedPhase` devices are served by
 *    the managed-cloud provider, not by a gateway principal, so gateway-backed
 *    procedures reject them (`MANAGED_DEVICE_UNSUPPORTED`) instead of hanging.
 *    Database-only reads (activity, working directories) stay available.
 *
 * Degradation matches the personal side: best-effort gateway reads answer
 * `null` / empty instead of a 500; terminal relays surface the device's reason
 * as `BAD_GATEWAY`.
 */

const SCAN_TIMEOUT_MS = 10_000;

/** The client a terminal session lives on, as `createTerminalSession` answered. */
const terminalClientSchema = z.enum(['cli', 'desktop']).optional();

/**
 * Row identity, not authority: `ownerId` disambiguates a PERSONAL row whose
 * `deviceId` is shared by two owners (`lh connect --device-id`).
 */
const deviceTargetInput = z.object({
  deviceId: z.string().trim().min(1).max(64),
  ownerId: z.string().trim().min(1).max(200).nullish(),
  workspaceId: z.string().trim().min(1).max(200).nullish(),
});

type DeviceTarget = z.infer<typeof deviceTargetInput>;

/** The principal a device's live reads must use: its owner, never the reader. */
export interface AdminDevicePrincipal {
  deviceId: string;
  userId: string;
  workspaceId?: string;
}

/**
 * Owner principal of a resolved device row.
 *
 * `undefined` only when the owner join produced no user (a row orphaned by a
 * mid-transaction read); such a device can never be asked anything.
 */
export const principalOfAdminDevice = (
  device: Pick<AdminDeviceDetail, 'deviceId' | 'owner' | 'workspace'>,
): AdminDevicePrincipal | undefined => {
  if (!device.owner.userId) return undefined;

  return {
    deviceId: device.deviceId,
    userId: device.owner.userId,
    workspaceId: device.workspace?.workspaceId,
  };
};

/** Managed cloud devices are not gateway principals; live reads are refused. */
const assertGatewayDevice = (device: AdminDeviceDetail) => {
  if (isManagedCloudDevice(device)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'MANAGED_DEVICE_UNSUPPORTED',
    });
  }
};

interface ResolveOptions {
  /** Set for procedures that must talk to the device over the gateway. */
  live?: boolean;
}

const resolveAdminDevice = async (
  ctx: { adminModel: Pick<AdminConsoleModel, 'getDevice'> },
  input: DeviceTarget,
  options: ResolveOptions = {},
): Promise<{ device: AdminDeviceDetail; principal: AdminDevicePrincipal }> => {
  const device = await ctx.adminModel.getDevice(input.deviceId, {
    ownerId: input.ownerId ?? undefined,
    workspaceId: input.workspaceId ?? null,
  });

  // Ambiguous or missing address: never pick a row for the administrator.
  if (!device) throw new TRPCError({ code: 'NOT_FOUND', message: 'DEVICE_NOT_FOUND' });

  const principal = principalOfAdminDevice(device);
  if (!principal) throw new TRPCError({ code: 'NOT_FOUND', message: 'DEVICE_OWNER_UNKNOWN' });

  if (options.live) assertGatewayDevice(device);

  return { device, principal };
};

/** Relay a terminal call, surfacing the device's own reason (as the personal side does). */
const relayTerminal = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export const adminDeviceDetailProcedures = {
  /** Running topics + agents routed to the device, as the owner sees them. */
  getDeviceActivity: adminProcedure.input(deviceTargetInput).query(async ({ ctx, input }) => {
    const { principal } = await resolveAdminDevice(ctx, input);
    const topicModel = new TopicModel(ctx.serverDB, principal.userId, principal.workspaceId);

    const [agents, runningTopics] = await Promise.all([
      loadDeviceBoundAgents({
        db: ctx.serverDB,
        deviceId: principal.deviceId,
        userId: principal.userId,
        workspaceId: principal.workspaceId,
      }),
      topicModel.queryTopics({ deviceId: principal.deviceId, statuses: ['running'] }),
    ]);

    const runUserIds = await resolveRunUserIds(topicModel, runningTopics);
    const users = await loadTopicUsers(ctx.serverDB, [...runUserIds.values()]);

    return {
      agents,
      runningTopics: runningTopics.map((topic) => ({
        ...topic,
        user: users.get(runUserIds.get(topic.id) ?? topic.userId) ?? null,
      })),
    };
  }),

  /** Installed agent runtimes, probed over the device connection as the owner. */
  getDeviceAgents: adminProcedure
    .input(deviceTargetInput)
    .query(
      async ({ ctx, input }): Promise<{ agents: HeterogeneousAgentScanMap; error?: string }> => {
        const { principal } = await resolveAdminDevice(ctx, input, { live: true });

        const result = await deviceGateway.executeToolCall(
          {
            deviceId: principal.deviceId,
            userId: principal.userId,
            workspaceId: principal.workspaceId,
          },
          {
            apiName: 'scanHeterogeneousAgents',
            arguments: JSON.stringify({}),
            identifier: 'local',
          },
          SCAN_TIMEOUT_MS,
        );

        if (!result.success) {
          return { agents: {}, error: result.error ?? 'Device tool call failed' };
        }

        try {
          const parsed = JSON.parse(result.content) as { agents?: HeterogeneousAgentScanMap };
          return { agents: parsed.agents ?? {} };
        } catch {
          return { agents: {}, error: 'Invalid response from device' };
        }
      },
    ),

  /**
   * System info + metric series for the overview card. Both come from the
   * gateway under the owner principal and keep the personal shapes, so the
   * detail page can reuse the same presentational components.
   */
  getDeviceOverview: adminProcedure.input(deviceTargetInput).query(async ({ ctx, input }) => {
    const { principal } = await resolveAdminDevice(ctx, input, { live: true });

    const [systemInfo, metrics] = await Promise.all([
      deviceGateway.queryDeviceSystemInfo(
        principal.userId,
        principal.deviceId,
        principal.workspaceId,
      ),
      buildDeviceMetricSeries({
        deviceId: principal.deviceId,
        userId: principal.userId,
        workspaceId: principal.workspaceId,
      }),
    ]);

    // `systemInfo` is `undefined` when the device is offline — a live state the
    // page renders, not an error.
    return { metrics, systemInfo: systemInfo ?? null };
  }),

  /** Default + recent working directories, straight from the device row. */
  getDeviceWorkingDirs: adminProcedure.input(deviceTargetInput).query(async ({ ctx, input }) => {
    const { device } = await resolveAdminDevice(ctx, input);

    return { defaultCwd: device.defaultCwd, workingDirs: device.workingDirs };
  }),

  /** Children of one directory inside a project on the device. `null` when offline. */
  listProjectDirectory: adminProcedure
    .input(
      deviceTargetInput.extend({
        relativePath: z.string(),
        root: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { principal } = await resolveAdminDevice(ctx, input, { live: true });

      const result = await deviceGateway.listProjectDirectory({
        deviceId: principal.deviceId,
        relativePath: input.relativePath,
        root: input.root,
        userId: principal.userId,
        workspaceId: principal.workspaceId,
      });
      return result ?? null;
    }),

  /** Read-only local file preview, rooted at the device's own working directory. */
  getLocalFilePreview: adminProcedure
    .input(
      deviceTargetInput.extend({
        accept: z.enum(['image']).optional(),
        path: z.string(),
        /** Defaults to the device's `defaultCwd`; the console has no topic to borrow one from. */
        workingDirectory: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { device, principal } = await resolveAdminDevice(ctx, input, { live: true });

      return deviceGateway.getLocalFilePreview({
        accept: input.accept,
        deviceId: principal.deviceId,
        path: input.path,
        userId: principal.userId,
        workingDirectory: input.workingDirectory ?? device.defaultCwd ?? '',
        workspaceId: principal.workspaceId,
      });
    }),

  /** Search project files; the device performs the match. `null` when offline. */
  searchProjectFiles: adminProcedure
    .input(
      deviceTargetInput.extend({
        changedOnly: z.boolean().optional(),
        excludeIgnored: z.boolean().optional(),
        limit: z.number().int().positive().max(500).optional(),
        query: z.string(),
        scope: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { principal } = await resolveAdminDevice(ctx, input, { live: true });

      const result = await deviceGateway.searchProjectFiles({
        changedOnly: input.changedOnly,
        deviceId: principal.deviceId,
        excludeIgnored: input.excludeIgnored,
        limit: input.limit,
        query: input.query,
        scope: input.scope,
        userId: principal.userId,
        workspaceId: principal.workspaceId,
      });
      return result ?? null;
    }),

  /** Whether a path exists and is a directory. `null` when the device is unreachable. */
  statPath: adminProcedure
    .input(deviceTargetInput.extend({ path: z.string() }))
    .query(async ({ ctx, input }) => {
      const { principal } = await resolveAdminDevice(ctx, input, { live: true });

      const result = await deviceGateway.statPath({
        deviceId: principal.deviceId,
        path: input.path,
        userId: principal.userId,
        workspaceId: principal.workspaceId,
      });
      return result ?? null;
    }),

  // ── Interactive terminal (owner principal, same relay semantics) ──────────

  createTerminalSession: adminProcedure
    .input(
      deviceTargetInput.extend({
        cols: z.number().int().min(1).max(1000),
        cwd: z.string().optional(),
        rows: z.number().int().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { principal } = await resolveAdminDevice(ctx, input, { live: true });

      return relayTerminal(() =>
        deviceGateway.createTerminalSession({
          cols: input.cols,
          cwd: input.cwd,
          deviceId: principal.deviceId,
          rows: input.rows,
          userId: principal.userId,
          workspaceId: principal.workspaceId,
        }),
      );
    }),

  readTerminal: adminProcedure
    .input(
      deviceTargetInput.extend({
        client: terminalClientSchema,
        cursor: z.number().int().min(0),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { principal } = await resolveAdminDevice(ctx, input, { live: true });

      return relayTerminal(() =>
        deviceGateway.readTerminal({
          client: input.client,
          cursor: input.cursor,
          deviceId: principal.deviceId,
          id: input.id,
          userId: principal.userId,
          workspaceId: principal.workspaceId,
        }),
      );
    }),

  resizeTerminal: adminProcedure
    .input(
      deviceTargetInput.extend({
        client: terminalClientSchema,
        cols: z.number().int().min(1).max(1000),
        id: z.string(),
        rows: z.number().int().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { principal } = await resolveAdminDevice(ctx, input, { live: true });

      return relayTerminal(() =>
        deviceGateway.resizeTerminal({
          client: input.client,
          cols: input.cols,
          deviceId: principal.deviceId,
          id: input.id,
          rows: input.rows,
          userId: principal.userId,
          workspaceId: principal.workspaceId,
        }),
      );
    }),

  writeTerminal: adminProcedure
    .input(
      deviceTargetInput.extend({
        client: terminalClientSchema,
        /** Base64 keystrokes; the same bound the personal route enforces. */
        data: z.string().max(65_536),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { principal } = await resolveAdminDevice(ctx, input, { live: true });

      return relayTerminal(() =>
        deviceGateway.writeTerminal({
          client: input.client,
          data: input.data,
          deviceId: principal.deviceId,
          id: input.id,
          userId: principal.userId,
          workspaceId: principal.workspaceId,
        }),
      );
    }),
};
