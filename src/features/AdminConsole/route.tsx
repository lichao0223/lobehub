import type { RouteObject } from 'react-router';

import { dynamicElement, dynamicLayout, ErrorBoundary } from '@/utils/router';

const userManagementElement = dynamicElement(
  () => import('@/routes/(main)/admin/users'),
  'Desktop > Admin > Users',
);

/**
 * `/admin` route definition (personal-only, desktop shell).
 *
 * Only the container route is registered in `desktopRouter.shared.tsx`; nested
 * paths live here so the shared router keeps a single-line change. `/admin`
 * itself renders user management (the canonical URL) and `/admin/users` stays
 * as a stable alias for deep links.
 */
export const adminConsoleRoute: RouteObject = {
  children: [
    { element: userManagementElement, index: true },
    { element: userManagementElement, path: 'users' },
  ],
  element: dynamicLayout(() => import('@/routes/(main)/admin'), 'Desktop > Admin', {
    preloadId: 'adminConsole',
  }),
  errorElement: <ErrorBoundary />,
  path: 'admin',
};
