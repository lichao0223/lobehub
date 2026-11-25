// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateLabOverrides } from '@/business/server/labs/resolver';

import { profileRouter } from './profile';

const mocks = vi.hoisted(() => ({
  countUpTo: vi.fn(),
  getLabsConfig: vi.fn(),
  getReferralStatus: vi.fn(),
  getRole: vi.fn(),
  getSubscriptionPlan: vi.fn(),
  getUserState: vi.fn(),
  hasMoreThanN: vi.fn(),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  // `ctx.serverDB` comes from the caller below; the real middleware would open the app pool.
  serverDatabase: async (opts: any) => opts.next({ ctx: opts.ctx }),
}));

vi.mock('@lobechat/database', () => ({
  AdminConsoleModel: class {
    getRole = mocks.getRole;
  },
  AdminConsoleSettingsModel: class {
    getLabsConfig = mocks.getLabsConfig;
  },
}));

vi.mock('@/business/server/user', () => ({
  getReferralStatus: mocks.getReferralStatus,
  getSubscriptionPlan: mocks.getSubscriptionPlan,
  onUserActivityForBusiness: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    countUpTo = mocks.countUpTo;
  },
}));
vi.mock('@/database/models/session', () => ({
  SessionModel: class {
    hasMoreThanN = mocks.hasMoreThanN;
  },
}));
vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserState = mocks.getUserState;
  },
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { getUserKeyVaults: vi.fn() },
}));
vi.mock('@/server/modules/S3');
vi.mock('@/server/services/user');
vi.mock('@/server/services/understanding/service', () => ({
  createUnderstandingService: vi.fn(),
}));
vi.mock('@/server/services/taskRecommendation/service', () => ({
  createTaskRecommendationService: vi.fn(),
  TaskRecommendationNotFoundError: class extends Error {},
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));

const USER_LAB = { enableGroupChat: true, enableSelfLearning: true };

const givenConfig = (mode: 'admin' | 'user', flags: Record<string, boolean> = {}) =>
  mocks.getLabsConfig.mockResolvedValue({
    config: { flags, mode },
    updatedAt: null,
    updatedBy: null,
  });

const readState = async () =>
  profileRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any).getUserState();

beforeEach(() => {
  vi.clearAllMocks();
  invalidateLabOverrides();
  mocks.countUpTo.mockResolvedValue(0);
  mocks.hasMoreThanN.mockResolvedValue(false);
  mocks.getReferralStatus.mockResolvedValue(undefined);
  mocks.getSubscriptionPlan.mockResolvedValue(undefined);
  mocks.getRole.mockResolvedValue('admin');
  mocks.getUserState.mockResolvedValue({
    email: 'user@example.com',
    preference: { lab: USER_LAB, language: 'zh-CN' },
    settings: {},
  });
  givenConfig('user');
});

describe('userRouter.getUserState with admin-managed Labs (CUST-009)', () => {
  it('admin mode: an unset lab reaches the client as off', async () => {
    givenConfig('admin');

    const state = await readState();

    // The user's own `true` must not leak through in admin mode.
    expect(state.preference.lab?.enableSelfLearning ?? false).toBe(false);
    expect(state.preference.lab?.enableGroupChat ?? false).toBe(false);
    expect(state.labsMode).toBe('admin');
    expect(state.isAdmin).toBe(true);
  });

  it('admin mode: an explicitly enabled lab reaches the client as on', async () => {
    givenConfig('admin', { enableSelfLearning: true });

    const state = await readState();

    expect(state.preference.lab?.enableSelfLearning).toBe(true);
    expect(state.labsMode).toBe('admin');
  });

  it('user mode passes the stored lab through untouched and keeps other fields', async () => {
    const state = await readState();

    expect(state.preference.lab).toEqual(USER_LAB);
    expect(state.preference.language).toBe('zh-CN');
    expect(state.labsMode).toBe('user');
    expect(state.isAdmin).toBeUndefined();
    expect(mocks.getRole).not.toHaveBeenCalled();
  });

  it('falls back to the user lab when the deployment config cannot be read', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getLabsConfig.mockRejectedValue(new Error('db down'));

    const state = await readState();

    // A broken Labs read must never fail the login.
    expect(state.preference.lab).toEqual(USER_LAB);
    expect(state.labsMode).toBe('user');
    errorSpy.mockRestore();
  });
});
