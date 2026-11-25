// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CODEX_APP_SERVER_RUNTIME, selectCodexDeviceDispatch } from './codexDeviceRuntime';

const mocks = vi.hoisted(() => ({
  getUserPreference: vi.fn(),
  resolveEffectiveLabForPreference: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserPreference = mocks.getUserPreference;
  },
}));

vi.mock('@/business/server/adminConsole/labs', () => ({
  resolveEffectiveLabForPreference: mocks.resolveEffectiveLabForPreference,
}));

const dispatch = () =>
  selectCodexDeviceDispatch({
    db: {} as never,
    heterogeneousProvider: { args: [], authMode: 'oauth', type: 'codex' },
    heteroType: 'codex',
    readSystemInfo: vi.fn().mockResolvedValue({
      ok: true,
      systemInfo: { supportedAgentRuntimes: [CODEX_APP_SERVER_RUNTIME] },
    }),
    resume: false,
    userId: 'user-1',
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserPreference.mockResolvedValue({ lab: { enableCodexAppServer: false } });
  // `user` mode (the upstream default) returns the stored lab unchanged.
  mocks.resolveEffectiveLabForPreference.mockImplementation(
    async (_db: unknown, preference: { lab?: Record<string, boolean> } | null | undefined) =>
      preference?.lab,
  );
});

describe('selectCodexDeviceDispatch app-server gate (CUST-009)', () => {
  it('admin mode: dispatches natively even when the user preference is off', async () => {
    mocks.resolveEffectiveLabForPreference.mockResolvedValue({ enableCodexAppServer: true });

    await expect(dispatch()).resolves.toMatchObject({ kind: 'native' });
  });

  it('admin mode: keeps `codex exec` when the deployment disabled the lab', async () => {
    mocks.getUserPreference.mockResolvedValue({ lab: { enableCodexAppServer: true } });
    mocks.resolveEffectiveLabForPreference.mockResolvedValue({ enableCodexAppServer: false });

    await expect(dispatch()).resolves.toEqual({ kind: 'exec' });
  });

  it('user mode: follows the personal switch', async () => {
    mocks.getUserPreference.mockResolvedValue({ lab: { enableCodexAppServer: true } });
    await expect(dispatch()).resolves.toMatchObject({ kind: 'native' });

    mocks.getUserPreference.mockResolvedValue({ lab: { enableCodexAppServer: false } });
    await expect(dispatch()).resolves.toEqual({ kind: 'exec' });
  });
});
