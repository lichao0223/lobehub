import type * as LobeConst from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { AdminConsoleLabsConfig } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyLabOverrides,
  invalidateLabOverrides,
  isLabEnabledForAdminMode,
  loadAdminLabsConfig,
  resolveLabGate,
  resolveLabOverrides,
  sanitizeLabFlags,
} from './resolver';

const getLabsConfigMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/database', () => ({
  AdminConsoleSettingsModel: class {
    getLabsConfig = getLabsConfigMock;
  },
}));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobeConst>();

  return {
    ...actual,
    DEFAULT_PREFERENCE: {
      ...actual.DEFAULT_PREFERENCE,
      // One lab defaults on so an explicit admin `false` can be proven to win.
      lab: { ...actual.DEFAULT_PREFERENCE.lab, enableAgentGraphConfig: true },
    },
  };
});

const makeDb = () => ({}) as LobeChatDatabase;

const givenConfig = (config: Partial<AdminConsoleLabsConfig> = {}) =>
  getLabsConfigMock.mockResolvedValue({
    config: { flags: config.flags ?? {}, mode: config.mode ?? 'user' },
    updatedAt: null,
    updatedBy: null,
  });

const adminOverrides = (flags: Record<string, boolean>): AdminConsoleLabsConfig => ({
  flags,
  mode: 'admin',
});

/** A key that upstream no longer ships (not in `UserLabSchema`). */
const ORPHAN_FLAG = 'enableRemovedUpstreamLab';

beforeEach(() => {
  vi.useRealTimers();
  getLabsConfigMock.mockReset();
  // Drops every entry cached by an earlier test.
  invalidateLabOverrides();
  givenConfig();
});

describe('applyLabOverrides', () => {
  it('user mode returns the user lab untouched', () => {
    const baseLab = { enableGroupChat: true, enableSelfLearning: true };

    expect(applyLabOverrides(baseLab, { flags: { enableGroupChat: false }, mode: 'user' })).toBe(
      baseLab,
    );
    expect(applyLabOverrides(undefined, { flags: {}, mode: 'user' })).toBeUndefined();
    expect(applyLabOverrides(null, { flags: {}, mode: 'user' })).toBeUndefined();
  });

  it('admin mode: unset labs are off and never fall back to the user preference', () => {
    const baseLab = { enableGroupChat: true, enableSelfLearning: true };
    const effective = applyLabOverrides(baseLab, { flags: {}, mode: 'admin' });

    // The user's own `true` must not leak into admin mode.
    expect(effective?.enableGroupChat ?? false).toBe(false);
    expect(effective?.enableSelfLearning ?? false).toBe(false);
    expect(isLabEnabledForAdminMode('enableGroupChat', adminOverrides({}))).toBe(false);
  });

  it('admin mode: an explicit true enables the lab', () => {
    const effective = applyLabOverrides(
      { enableGroupChat: false },
      adminOverrides({ enableGroupChat: true }),
    );

    expect(effective?.enableGroupChat).toBe(true);
    expect(
      isLabEnabledForAdminMode('enableGroupChat', adminOverrides({ enableGroupChat: true })),
    ).toBe(true);
  });

  it('admin mode: an explicit false overrides a default-on lab', () => {
    // `enableAgentGraphConfig` defaults to true in the mocked DEFAULT_PREFERENCE.
    expect(applyLabOverrides(undefined, adminOverrides({}))?.enableAgentGraphConfig).toBe(true);

    const effective = applyLabOverrides(
      undefined,
      adminOverrides({ enableAgentGraphConfig: false }),
    );

    expect(effective?.enableAgentGraphConfig).toBe(false);
    expect(
      isLabEnabledForAdminMode(
        'enableAgentGraphConfig',
        adminOverrides({ enableAgentGraphConfig: false }),
      ),
    ).toBe(false);
  });
});

describe('orphan labs', () => {
  it('drops keys deleted upstream without throwing', async () => {
    expect(
      sanitizeLabFlags({
        enableGroupChat: true,
        [ORPHAN_FLAG]: true,
        // Malformed values are dropped too.
        enableSelfLearning: 'yes',
      }),
    ).toEqual({ enableGroupChat: true });

    const db = makeDb();
    givenConfig({ flags: { enableGroupChat: true, [ORPHAN_FLAG]: true }, mode: 'admin' });

    await expect(resolveLabOverrides(db)).resolves.toEqual({
      flags: { enableGroupChat: true },
      mode: 'admin',
    });

    // The resolved payload carries no orphan key for the client to render.
    const effective = applyLabOverrides(undefined, await resolveLabOverrides(db));
    expect(effective).not.toHaveProperty(ORPHAN_FLAG);
    expect(effective?.enableGroupChat).toBe(true);
  });
});

describe('resolveLabOverrides cache', () => {
  it('reuses one query for 5s and refreshes after invalidateLabOverrides', async () => {
    vi.useFakeTimers();
    const db = makeDb();
    givenConfig({ flags: { enableGroupChat: true }, mode: 'admin' });

    await expect(resolveLabOverrides(db)).resolves.toMatchObject({ mode: 'admin' });
    await resolveLabOverrides(db);
    expect(getLabsConfigMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4999);
    await resolveLabOverrides(db);
    expect(getLabsConfigMock).toHaveBeenCalledTimes(1);

    // Past the TTL the next resolve reads again.
    vi.advanceTimersByTime(2);
    await resolveLabOverrides(db);
    expect(getLabsConfigMock).toHaveBeenCalledTimes(2);

    // A write (S1) invalidates immediately instead of waiting out the TTL.
    givenConfig({ flags: {}, mode: 'user' });
    invalidateLabOverrides(db);
    await expect(resolveLabOverrides(db)).resolves.toEqual({ flags: {}, mode: 'user' });
    expect(getLabsConfigMock).toHaveBeenCalledTimes(3);
  });

  it('invalidating without a handle drops entries cached for any db', async () => {
    const db = makeDb();

    await resolveLabOverrides(db);
    invalidateLabOverrides();
    await resolveLabOverrides(db);

    expect(getLabsConfigMock).toHaveBeenCalledTimes(2);
  });
});

describe('admin gate', () => {
  it('leaves user mode to the upstream per-user behaviour', async () => {
    const db = makeDb();
    givenConfig({ mode: 'user' });

    await expect(resolveLabGate(db, 'enableSelfLearning')).resolves.toBeUndefined();
    expect(
      isLabEnabledForAdminMode('enableSelfLearning', { flags: {}, mode: 'user' }),
    ).toBeUndefined();
  });

  it('reads the same cached config as the effective lab payload', async () => {
    const db = makeDb();
    givenConfig({ flags: { enableSelfLearning: true }, mode: 'admin' });

    await expect(resolveLabGate(db, 'enableSelfLearning')).resolves.toBe(true);
    await expect(resolveLabGate(db, 'enableGroupChat')).resolves.toBe(false);
    // Both gate calls and the payload read share one settings query.
    expect(getLabsConfigMock).toHaveBeenCalledTimes(1);

    const overrides = await resolveLabOverrides(db);
    const effective = applyLabOverrides(undefined, overrides);

    expect(effective?.enableSelfLearning).toBe(true);
    expect(isLabEnabledForAdminMode('enableSelfLearning', overrides)).toBe(true);
    expect(effective?.enableGroupChat ?? false).toBe(false);
    expect(isLabEnabledForAdminMode('enableGroupChat', overrides)).toBe(false);
  });
});

describe('loadAdminLabsConfig', () => {
  it('answers the upstream default when the settings read fails', async () => {
    const db = makeDb();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getLabsConfigMock.mockRejectedValueOnce(new Error('db down'));

    await expect(loadAdminLabsConfig(db)).resolves.toEqual({ flags: {}, mode: 'user' });

    errorSpy.mockRestore();
  });

  it('normalizes an unexpected stored mode back to user', async () => {
    const db = makeDb();
    getLabsConfigMock.mockResolvedValueOnce({
      config: { flags: { enableGroupChat: true }, mode: 'nonsense' },
      updatedAt: null,
      updatedBy: null,
    });

    await expect(loadAdminLabsConfig(db)).resolves.toEqual({
      flags: { enableGroupChat: true },
      mode: 'user',
    });
  });
});
