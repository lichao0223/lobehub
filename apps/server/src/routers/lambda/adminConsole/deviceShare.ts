import { isManagedCloudDevice } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { adminProcedure } from '@/business/server/adminConsole/permissions';
import { DeviceModel } from '@/database/models/device';
import { WorkspaceModel } from '@/database/models/workspace';
import { signWorkspaceDeviceToken } from '@/libs/trpc/utils/internalJwt';
import { deviceGateway } from '@/server/services/deviceGateway';

import { parseReportedIdentitySource } from '../device/guards';

const personalInput = z.object({
  deviceId: z.string().trim().min(1).max(64),
  ownerId: z.string().trim().min(1).max(200),
});

const targetInput = personalInput.extend({
  workspaceId: z.string().trim().min(1).max(64),
});

/**
 * Console-created device shares (CUST-010 follow-up).
 *
 * A share is an ordinary workspace device row PLUS `share_origin = 'admin'`:
 * the console acts on behalf of the device owner (the gateway enrollment is
 * addressed to the owner's personal pool), publishes it to the whole workspace
 * (`public` is forced — a private row would only be visible to its enroller),
 * and from then on only the console may revoke it.
 */
export const adminDeviceShareProcedures = {
  /** Shares created from the console for this personal device. */
  listDeviceShares: adminProcedure.input(personalInput).query(async ({ ctx, input }) => {
    const device = await ctx.adminModel.getDevice(input.deviceId, {
      ownerId: input.ownerId,
      workspaceId: null,
    });
    if (!device) throw new TRPCError({ code: 'NOT_FOUND', message: 'DEVICE_NOT_FOUND' });
    const shares = await ctx.adminModel.listAdminDeviceShares(input.ownerId, device.deviceId);
    return shares.map((share) => ({
      deviceId: share.deviceId,
      workspaceId: share.workspaceId,
      workspaceName: share.workspaceName,
    }));
  }),

  shareDeviceToWorkspace: adminProcedure.input(targetInput).mutation(async ({ ctx, input }) => {
    const device = await ctx.adminModel.getDevice(input.deviceId, {
      ownerId: input.ownerId,
      workspaceId: null,
    });
    if (!device || device.scope !== 'personal') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'DEVICE_NOT_FOUND' });
    }
    if (device.owner?.userId !== input.ownerId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'DEVICE_NOT_FOUND' });
    }
    if (isManagedCloudDevice(device as never)) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'MANAGED_DEVICE_UNSUPPORTED',
      });
    }

    // Short-circuit before touching the device: re-enrolling an already shared
    // machine would open a second workspace connection for nothing.
    const knownShares = await ctx.adminModel.listAdminDeviceShares(input.ownerId, device.deviceId);
    const known = knownShares.find((share) => share.workspaceId === input.workspaceId);
    if (known) return { alreadyShared: true as const, deviceId: known.deviceId };

    const workspace = await new WorkspaceModel(ctx.serverDB, ctx.adminUserId).findById(
      input.workspaceId,
    );
    if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'WORKSPACE_NOT_FOUND' });

    const token = await signWorkspaceDeviceToken(input.workspaceId);
    // Enroll against the OWNER's personal pool — the machine is theirs, the
    // workspace connection is what makes it reachable by members.
    const result = await deviceGateway.enrollWorkspace({
      deviceId: device.deviceId,
      token,
      userId: input.ownerId,
      workspaceId: input.workspaceId,
    });
    if (!result.success || !result.identity) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: result.error ?? 'Device is offline or does not support workspace sharing.',
      });
    }

    const existing = await ctx.adminModel.findWorkspaceDeviceRow(
      input.workspaceId,
      result.identity.deviceId,
    );
    if (existing) {
      if (existing.shareOrigin === 'admin') {
        return { alreadyShared: true as const, deviceId: existing.deviceId };
      }
      // The member-side row wins; drop the connection we just opened so the
      // machine is not left holding a workspace socket without a share row.
      await deviceGateway.unenrollWorkspace({
        deviceId: result.identity.deviceId,
        userId: input.ownerId,
        workspaceId: input.workspaceId,
      });
      throw new TRPCError({ code: 'CONFLICT', message: 'WORKSPACE_DEVICE_EXISTS' });
    }

    const model = new DeviceModel(ctx.serverDB, input.ownerId, input.workspaceId);
    try {
      await model.registerWorkspaceDevice({
        deviceId: result.identity.deviceId,
        hostname: device.hostname ?? undefined,
        identitySource:
          device.identitySource === 'machine-id'
            ? parseReportedIdentitySource('machine-id')
            : parseReportedIdentitySource('fallback'),
        platform: device.platform ?? undefined,
        shareOrigin: 'admin',
        sharedByUserId: ctx.adminUserId,
        sharedFromDeviceId: device.deviceId,
        visibility: 'public',
        workspaceId: input.workspaceId,
      });
    } catch (error) {
      // The machine already opened a workspace connection; leaving it without a
      // row would surface a ghost device. Roll it back before rethrowing.
      await deviceGateway.unenrollWorkspace({
        deviceId: result.identity.deviceId,
        userId: input.ownerId,
        workspaceId: input.workspaceId,
      });
      throw error;
    }

    return { alreadyShared: false as const, deviceId: result.identity.deviceId };
  }),

  revokeDeviceShare: adminProcedure.input(targetInput).mutation(async ({ ctx, input }) => {
    const device = await ctx.adminModel.getDevice(input.deviceId, {
      ownerId: input.ownerId,
      workspaceId: null,
    });
    if (!device || device.scope !== 'personal') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'DEVICE_NOT_FOUND' });
    }

    const shares = await ctx.adminModel.listAdminDeviceShares(input.ownerId, device.deviceId);
    const share = shares.find((item) => item.workspaceId === input.workspaceId);
    if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'SHARE_NOT_FOUND' });

    await deviceGateway.unenrollWorkspace({
      deviceId: share.deviceId,
      userId: input.ownerId,
      workspaceId: input.workspaceId,
    });
    await ctx.adminModel.deleteWorkspaceDeviceRow(input.workspaceId, share.deviceId);

    return { success: true as const };
  }),
};
