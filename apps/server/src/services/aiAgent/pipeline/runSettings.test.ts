// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunFacts } from '../runFacts';
import { resolveRunSettings } from './runSettings';

const mocks = vi.hoisted(() => ({ resolveEffectiveLabForPreference: vi.fn() }));

vi.mock('@/business/server/adminConsole/labs', () => ({
  resolveEffectiveLabForPreference: mocks.resolveEffectiveLabForPreference,
}));

const db = {} as RunFacts['db'];

const createFacts = (lab: Record<string, boolean> | undefined): RunFacts => ({
  db,
  deviceSystemInfo: vi.fn(),
  userPreference: vi.fn().mockResolvedValue(lab === undefined ? undefined : { lab }),
  userSettings: vi.fn().mockResolvedValue({}),
});

const agentConfig = { chatConfig: {} } as Parameters<typeof resolveRunSettings>[0]['agentConfig'];

beforeEach(() => {
  vi.clearAllMocks();
  // `user` mode (the upstream default) returns the stored lab unchanged.
  mocks.resolveEffectiveLabForPreference.mockImplementation(
    async (_db: unknown, preference: { lab?: Record<string, boolean> } | null | undefined) =>
      preference?.lab,
  );
});

describe('resolveRunSettings expertise gate (CUST-009)', () => {
  it('admin mode: enables expertise even when the user never turned it on', async () => {
    mocks.resolveEffectiveLabForPreference.mockResolvedValue({ enableSelfLearning: true });

    const settings = await resolveRunSettings({
      agentConfig,
      runFacts: createFacts({ enableSelfLearning: false }),
    });

    expect(settings.enableExpertise).toBe(true);
  });

  it('admin mode: disables expertise even when the user turned it on', async () => {
    mocks.resolveEffectiveLabForPreference.mockResolvedValue({ enableSelfLearning: false });

    const settings = await resolveRunSettings({
      agentConfig,
      runFacts: createFacts({ enableSelfLearning: true }),
    });

    expect(settings.enableExpertise).toBe(false);
  });

  it('user mode: follows the personal switch', async () => {
    const on = await resolveRunSettings({
      agentConfig,
      runFacts: createFacts({ enableSelfLearning: true }),
    });
    const off = await resolveRunSettings({
      agentConfig,
      runFacts: createFacts({ enableSelfLearning: false }),
    });

    expect(on.enableExpertise).toBe(true);
    expect(off.enableExpertise).toBe(false);
  });
});
