/**
 * CUST-008 §12.6: Better Auth's native `/admin/*` endpoints write account state
 * directly, bypassing the console's ban / role guards, API-key disabling and
 * last-admin protection. Answering them as 404 keeps `adminConsole.*` the only
 * writer of account state.
 */
const BLOCKED_ADMIN_ENDPOINT = '/api/auth/admin';

export const isBlockedAdminEndpoint = (pathname: string): boolean =>
  pathname === BLOCKED_ADMIN_ENDPOINT || pathname.startsWith(`${BLOCKED_ADMIN_ENDPOINT}/`);
