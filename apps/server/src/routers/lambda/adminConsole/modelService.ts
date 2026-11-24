import { type AdminConsoleAiConfigUpdate, COMPANY_MODEL_CAPABILITIES } from '@lobechat/types';
import { AiModelTypeSchema } from 'model-bank';
import { z } from 'zod';

import { createAdminConsoleModelService } from '@/business/server/adminConsole/modelService';
import { adminProcedure } from '@/business/server/adminConsole/permissions';

/**
 * Admin console model service endpoints (CUST-008 §7).
 *
 * Both procedures run on `adminProcedure`; the service only ever returns the
 * key's last 4 characters, never its ciphertext or plaintext.
 */

const companyModelSchema = z.object({
  capabilities: z.array(z.enum(COMPANY_MODEL_CAPABILITIES)).max(3).optional(),
  contextWindowTokens: z.number().int().positive().optional(),
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  open: z.boolean(),
  removedAt: z.string().datetime({ offset: true }).optional(),
  source: z.enum(['sync', 'manual']),
  pending: z.boolean().optional(),
  type: AiModelTypeSchema,
});

const defaultsSchema = z.object({
  chat: z.string().trim().min(1).max(200).optional(),
  embedding: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  verify: z.string().trim().min(1).max(200).optional(),
});

const updateInputSchema = z.object({
  apiKey: z.string().trim().min(8).max(4096).optional(),
  baseURL: z.string().trim().min(1).max(2048).optional(),
  defaults: defaultsSchema.optional(),
  enabled: z.boolean(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  models: z.array(companyModelSchema).max(500).optional(),
});

export const adminModelServiceProcedures = {
  getModelServiceConfig: adminProcedure.query(({ ctx }) =>
    createAdminConsoleModelService(ctx.serverDB, ctx.adminUserId).getConfig(),
  ),

  updateModelServiceConfig: adminProcedure
    .input(updateInputSchema)
    .mutation(({ ctx, input }) =>
      createAdminConsoleModelService(ctx.serverDB, ctx.adminUserId).updateConfig(
        input as AdminConsoleAiConfigUpdate,
      ),
    ),
};
