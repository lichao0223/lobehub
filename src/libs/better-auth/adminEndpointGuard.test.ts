import { describe, expect, it } from 'vitest';

import { isBlockedAdminEndpoint } from './adminEndpointGuard';

describe('isBlockedAdminEndpoint', () => {
  it.each([
    '/api/auth/admin',
    '/api/auth/admin/',
    '/api/auth/admin/ban-user',
    '/api/auth/admin/set-role',
    '/api/auth/admin/impersonate-user',
  ])('blocks Better Auth admin endpoint %s', (pathname) => {
    expect(isBlockedAdminEndpoint(pathname)).toBe(true);
  });

  it.each([
    '/api/auth/sign-in/email',
    '/api/auth/get-session',
    // A sibling path must not be swallowed by a prefix match.
    '/api/auth/administrator',
    '/api/auth/adminx/ban-user',
    '/apix/auth/admin/ban-user',
  ])('leaves %s routed to Better Auth', (pathname) => {
    expect(isBlockedAdminEndpoint(pathname)).toBe(false);
  });
});
