import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { adminProcedure } from '@/business/server/adminConsole/permissions';
import { WorkspaceModel } from '@/database/models/workspace';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { LobeChatDatabase } from '@/database/type';

const roleSchema = z.enum(['admin', 'member']);

const workspaceIdSchema = z.string().trim().min(1).max(64);

const slugify = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replaceAll(/[^\d a-z-]+/g, '')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 60);

const assertWorkspace = async (db: LobeChatDatabase, adminUserId: string, id: string) => {
  const workspace = await new WorkspaceModel(db, adminUserId).findById(id);
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'WORKSPACE_NOT_FOUND' });
  return workspace;
};

/**
 * Workspace management for the admin console (CUST-008 follow-up).
 *
 * Writes go through the same models the workspace UI uses: the admin becomes the
 * creator (`owner`) of a new workspace, and member changes are ordinary
 * membership rows. No parallel permission system is introduced.
 */
export const adminWorkspaceProcedures = {
  listWorkspaces: adminProcedure
    .input(
      z
        .object({
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(50).optional(),
          q: z.string().trim().max(200).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => ctx.adminModel.listWorkspaces(input ?? {})),

  listWorkspaceMembers: adminProcedure
    .input(z.object({ workspaceId: workspaceIdSchema }))
    .query(async ({ ctx, input }) => {
      await assertWorkspace(ctx.serverDB, ctx.adminUserId, input.workspaceId);
      return ctx.adminModel.listWorkspaceMembers(input.workspaceId);
    }),

  createWorkspace: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(255),
        slug: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const model = new WorkspaceModel(ctx.serverDB, ctx.adminUserId);

      let slug = slugify(input.slug ?? input.name) || `workspace-${Date.now().toString(36)}`;
      if (await model.findBySlug(slug)) {
        slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      }

      const workspace = await model.create({ name: input.name, slug });
      return { id: workspace.id, name: workspace.name, slug: workspace.slug };
    }),

  addWorkspaceMember: adminProcedure
    .input(
      z.object({
        identity: z.string().trim().min(1).max(200),
        role: roleSchema.default('member'),
        workspaceId: workspaceIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspace(ctx.serverDB, ctx.adminUserId, input.workspaceId);

      const user = await ctx.adminModel.findUserByIdentity(input.identity);
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'USER_NOT_FOUND' });

      const model = new WorkspaceMemberModel(ctx.serverDB, ctx.adminUserId);
      const existing = await model.getMember(input.workspaceId, user.id);
      if (existing && !existing.deletedAt) {
        throw new TRPCError({ code: 'CONFLICT', message: 'ALREADY_A_MEMBER' });
      }

      const member = await model.addMember({
        role: input.role,
        userId: user.id,
        workspaceId: input.workspaceId,
      });
      return { role: member.role, userId: member.userId };
    }),

  updateWorkspaceMemberRole: adminProcedure
    .input(
      z.object({
        role: roleSchema,
        userId: z.string().trim().min(1),
        workspaceId: workspaceIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspace(ctx.serverDB, ctx.adminUserId, input.workspaceId);
      await assertNotOwner(ctx, input.workspaceId, input.userId, 'OWNER_ROLE_IMMUTABLE');
      await new WorkspaceMemberModel(ctx.serverDB, ctx.adminUserId).updateMemberRole(
        input.workspaceId,
        input.userId,
        input.role,
      );
      return { success: true };
    }),

  removeWorkspaceMember: adminProcedure
    .input(z.object({ userId: z.string().trim().min(1), workspaceId: workspaceIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspace(ctx.serverDB, ctx.adminUserId, input.workspaceId);
      await assertNotOwner(ctx, input.workspaceId, input.userId, 'OWNER_CANNOT_BE_REMOVED');
      await new WorkspaceMemberModel(ctx.serverDB, ctx.adminUserId).removeMember(
        input.workspaceId,
        input.userId,
      );
      return { success: true };
    }),
};

/**
 * The workspace owner is the billing-bound `primaryOwnerId` and the database
 * enforces at most one active `owner` row per workspace. Ownership transfer is
 * an owner-initiated operation upstream, so the console treats the owner as
 * read-only: you can add/remove admins and members, not swap the owner.
 */
const assertNotOwner = async (
  ctx: { adminModel: { listWorkspaceMembers: (id: string) => Promise<any[]> } },
  workspaceId: string,
  userId: string,
  message: string,
) => {
  const members = await ctx.adminModel.listWorkspaceMembers(workspaceId);
  const target = members.find((member) => member.userId === userId);
  if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'MEMBER_NOT_FOUND' });
  if (target.role === 'owner') throw new TRPCError({ code: 'BAD_REQUEST', message });
};
