import type { AdminConsoleModelServiceConfig } from '@lobechat/types';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { adminConsoleService } from '@/services/adminConsole';

export const ADMIN_CONSOLE_MODEL_SERVICE_KEY = 'admin-console-model-service';

export const useAdminModelService = () =>
  useClientDataSWR<AdminConsoleModelServiceConfig>([ADMIN_CONSOLE_MODEL_SERVICE_KEY], () =>
    adminConsoleService.getModelServiceConfig(),
  );

/** Invalidate the read so the page paints the version the server just wrote. */
export const refreshAdminModelService = () => mutate([ADMIN_CONSOLE_MODEL_SERVICE_KEY]);
