import type { AdminWhoamiResult } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { adminConsoleService } from '@/services/adminConsole';

export const ADMIN_CONSOLE_WHOAMI_KEY = 'admin-console-whoami';

/**
 * `enabled` lets call sites that only need the entry (the user menu) avoid the
 * request for signed-out visitors. The guard inside `/admin` always enables it.
 */
export const useAdminWhoami = (enabled = true) =>
  useClientDataSWR<AdminWhoamiResult>(
    enabled ? [ADMIN_CONSOLE_WHOAMI_KEY] : null,
    () => adminConsoleService.whoami(),
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
