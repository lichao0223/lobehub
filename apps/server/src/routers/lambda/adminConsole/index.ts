import { resolveAdminState } from '@/business/server/adminConsole/permissions';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { adminModelServiceProcedures } from './modelService';
import { adminUserProcedures } from './users';

/**
 * Admin console (CUST-008).
 *
 * `whoami` is the only endpoint reachable by a normal user: the `/admin` guard
 * needs to tell "not an admin" apart from "session expired", and bootstrap
 * happens here on the first visit.
 */
export const adminConsoleRouter = router({
  ...adminUserProcedures,
  ...adminModelServiceProcedures,

  whoami: authedProcedure
    .use(serverDatabase)
    .query(({ ctx }) => resolveAdminState(ctx.serverDB, ctx.userId)),
});
