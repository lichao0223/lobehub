import type { AdminUserListParams, AdminUserListResult } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { adminConsoleService } from '@/services/adminConsole';

export const ADMIN_CONSOLE_USERS_KEY = 'admin-console-users';

export const useAdminUsers = (params: AdminUserListParams) =>
  useClientDataSWR<AdminUserListResult>([ADMIN_CONSOLE_USERS_KEY, params], () =>
    adminConsoleService.listUsers(params),
  );
