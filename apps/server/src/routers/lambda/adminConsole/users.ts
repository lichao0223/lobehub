import { ADMIN_ROLES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { adminProcedure } from '@/business/server/adminConsole/permissions';
import { deleteUserAccount } from '@/server/services/adminConsole/userDeletion';

const userId = z.string().min(1);

const targetInput = z.object({ userId });

export const adminUserProcedures = {
  listUsers: adminProcedure
    .input(
      z
        .object({
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(100).optional(),
          q: z.string().trim().max(100).optional(),
          role: z.enum(['admin', 'user']).optional(),
          status: z.enum(['active', 'banned']).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => ctx.adminModel.listUsers(input ?? {})),

  getUser: adminProcedure.input(targetInput).query(async ({ ctx, input }) => {
    const user = await ctx.adminModel.getUser(input.userId);
    if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'USER_NOT_FOUND' });
    return user;
  }),

  setUserRole: adminProcedure
    .input(z.object({ role: z.enum(ADMIN_ROLES), userId }))
    .mutation(({ ctx, input }) => ctx.adminModel.setRole(input.userId, input.role)),

  banUser: adminProcedure
    .input(
      z.object({
        expiresAt: z.coerce.date().optional(),
        reason: z.string().trim().min(1).max(500),
        userId,
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.adminModel.banUser(input.userId, input.reason, input.expiresAt),
    ),

  unbanUser: adminProcedure
    .input(targetInput)
    .mutation(({ ctx, input }) => ctx.adminModel.unbanUser(input.userId)),

  revokeUserSessions: adminProcedure.input(targetInput).mutation(async ({ ctx, input }) => ({
    count: await ctx.adminModel.revokeSessions(input.userId),
  })),

  /**
   * Physical delete (CUST-008). The account row and everything that cascades
   * from it are removed, so the same email / SSO subject can register again.
   * The model refuses self and any admin target (`SELF_LOCKOUT`,
   * `ADMIN_PROTECTED`).
   */
  deleteUser: adminProcedure
    .input(targetInput)
    .mutation(({ ctx, input }) => deleteUserAccount(ctx.serverDB, ctx.adminUserId, input.userId)),
};
