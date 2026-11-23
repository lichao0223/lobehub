import type { AdminUserDetail } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { adminConsoleService } from '@/services/adminConsole';

export const ADMIN_CONSOLE_USER_KEY = 'admin-console-user';

export const useAdminUser = (userId: string | null) =>
  useClientDataSWR<AdminUserDetail>(userId ? [ADMIN_CONSOLE_USER_KEY, userId] : null, () =>
    adminConsoleService.getUser(userId!),
  );
