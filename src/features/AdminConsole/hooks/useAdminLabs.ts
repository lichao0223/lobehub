import type { AdminConsoleLabsConfigView } from '@lobechat/types';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminConsoleService } from '@/services/adminConsole';

export const ADMIN_CONSOLE_LABS_KEY = 'admin-console-labs';

export const useAdminLabs = () =>
  useClientDataSWR<AdminConsoleLabsConfigView>([ADMIN_CONSOLE_LABS_KEY], () =>
    adminConsoleService.getLabsConfig(),
  );

/** Paint the version the server just wrote. */
export const refreshAdminLabs = () => mutate([ADMIN_CONSOLE_LABS_KEY]);
