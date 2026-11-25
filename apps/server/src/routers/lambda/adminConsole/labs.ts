import type { AdminConsoleLabsConfigUpdate } from '@lobechat/types';
import { z } from 'zod';

import { readAdminLabsConfig, updateAdminLabsConfig } from '@/business/server/adminConsole/labs';
import { adminProcedure } from '@/business/server/adminConsole/permissions';

/**
 * Unified Labs switch endpoints (CUST-009).
 *
 * The matrix is not duplicated here: the admin page renders it from the
 * upstream lab feature list / selectors, and the write validates flag keys
 * against the upstream `UserLabSchema`, so a new upstream lab is accepted
 * without touching this router.
 */

const labsInputSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  flags: z.record(z.string().min(1).max(120), z.boolean()).optional(),
  mode: z.enum(['user', 'admin']),
});

export const adminLabsProcedures = {
  /** Uncached read so the page always paints the stored row. */
  getLabsConfig: adminProcedure.query(({ ctx }) => readAdminLabsConfig(ctx.serverDB)),

  updateLabsConfig: adminProcedure
    .input(labsInputSchema)
    .mutation(({ ctx, input }) =>
      updateAdminLabsConfig(ctx.serverDB, input as AdminConsoleLabsConfigUpdate, ctx.adminUserId),
    ),
};
