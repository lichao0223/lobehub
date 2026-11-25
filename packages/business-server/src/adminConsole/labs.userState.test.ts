import type { LobeChatDatabase } from '@lobechat/database';
import type { AdminRole } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateLabOverrides } from '../labs/resolver';
import { resolveLabsForUserState } from './labs';

const getLabsConfigMock = vi.hoisted(() => vi.fn());
const getRoleMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/database', () => ({
  AdminConsoleModel: class {
    getRole = getRoleMock;
  },
  AdminConsoleSettingsModel: class {
    getLabsConfig = getLabsConfigMock;
  },
}));

const db = {} as LobeChatDatabase;

const givenConfig = (mode: 'admin' | 'user', flags: Record<string, boolean> = {}) =>
  getLabsConfigMock.mockResolvedValue({
    config: { flags, mode },
    updatedAt: null,
    updatedBy: null,
  });

const givenRole = (role: AdminRole | undefined) => getRoleMock.mockResolvedValue(role);

const USER_LAB = { enableGroupChat: true, enableSelfLearning: true };

beforeEach(() => {
  getLabsConfigMock.mockReset();
  getRoleMock.mockReset();
  invalidateLabOverrides();
});

describe('resolveLabsForUserState', () => {
  it('user mode passes the stored lab through untouched', async () => {
    // The user owns Labs in this mode; the bootstrap must not rewrite the row.
    givenConfig('user', { enableSelfLearning: false });

    const result = await resolveLabsForUserState(db, 'user-1', USER_LAB);

    expect(result).toEqual({ lab: USER_LAB, labsMode: 'user' });
    expect(getRoleMock).not.toHaveBeenCalled();
  });

  it('admin mode: an unset lab is off even when the user turned it on', async () => {
    givenConfig('admin');
    givenRole('admin');

    const result = await resolveLabsForUserState(db, 'user-1', USER_LAB);

    expect(result.labsMode).toBe('admin');
    expect(result.lab?.enableSelfLearning ?? false).toBe(false);
    expect(result.lab?.enableGroupChat ?? false).toBe(false);
    expect(result.isAdmin).toBe(true);
  });

  it('admin mode: an explicitly enabled lab is on for every user', async () => {
    givenConfig('admin', { enableSelfLearning: true });
    givenRole(undefined);

    const result = await resolveLabsForUserState(db, 'user-1', { enableSelfLearning: false });

    expect(result.lab?.enableSelfLearning).toBe(true);
    expect(result.isAdmin).toBe(false);
  });

  it('degrades to a non-admin Labs page when the role read fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    givenConfig('admin', { enableSelfLearning: true });
    getRoleMock.mockRejectedValue(new Error('db down'));

    const result = await resolveLabsForUserState(db, 'user-1', USER_LAB);

    expect(result.isAdmin).toBe(false);
    expect(result.lab?.enableSelfLearning).toBe(true);
    errorSpy.mockRestore();
  });
});
