// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  post: vi.fn<(request: Request) => Promise<Response>>(async () => Response.json({ ok: true })),
}));

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: vi.fn(() => ({ GET: vi.fn(), POST: mocks.post })),
}));

vi.mock('@/auth', () => ({
  auth: {},
}));

const createRequest = (path: string) =>
  new Request(`https://localhost${path}`, {
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }) as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockResolvedValue(Response.json({ ok: true }));
});

describe('Better Auth native admin endpoints are closed (CUST-008 §12.6)', () => {
  it.each(['/api/auth/admin', '/api/auth/admin/ban-user', '/api/auth/admin/set-role'])(
    'answers %s with 404 instead of reaching Better Auth',
    async (path) => {
      const response = await POST(createRequest(path));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ code: 'NOT_FOUND', message: 'Not Found' });
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it('still delegates ordinary auth endpoints', async () => {
    const response = await POST(createRequest('/api/auth/sign-in/email'));

    expect(response.status).toBe(200);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('does not swallow a sibling path that merely starts with "admin"', async () => {
    const response = await POST(createRequest('/api/auth/administrator'));

    expect(response.status).toBe(200);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});
