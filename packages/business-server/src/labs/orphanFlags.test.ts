import type { LobeChatDatabase } from '@lobechat/database';
import { ADMIN_CONSOLE_ERROR, UserLabSchema } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveLabsForUserState, updateAdminLabsConfig } from '../adminConsole/labs';
import {
  applyLabOverrides,
  invalidateLabOverrides,
  isKnownLabFlag,
  resolveLabOverrides,
  sanitizeLabFlags,
} from './resolver';

/**
 * CUST-009 gate (test time): the deployment config tolerates lab flags this
 * build no longer knows, and it follows the upstream registry without a second
 * list.
 *
 * The two halves of that promise are opposite directions, so they are asserted
 * together here (the resolver's own `orphan labs` suite covers the flag map
 * itself):
 *
 * - read path: a stored key that upstream deleted must disappear from the
 *   payload the client renders, without throwing — an old config row can never
 *   break sign-in after an upstream upgrade;
 * - registry: the known-flag set is derived from `UserLabSchema`, so a lab
 *   added upstream is accepted by the admin write immediately, with no
 *   registration step in this fork.
 */

const getLabsConfigMock = vi.hoisted(() => vi.fn());
const getRoleMock = vi.hoisted(() => vi.fn());
const updateLabsConfigMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/database', () => ({
  AdminConsoleModel: class {
    getRole = getRoleMock;
  },
  AdminConsoleSettingsModel: class {
    getLabsConfig = getLabsConfigMock;
    updateLabsConfig = updateLabsConfigMock;
  },
}));

const db = {} as LobeChatDatabase;

/** A flag that exists in a stored config but not in this build's schema. */
const ORPHAN_FLAG = 'enableRemovedUpstreamLab';

const givenConfig = (mode: 'admin' | 'user', flags: Record<string, boolean> = {}) =>
  getLabsConfigMock.mockResolvedValue({
    config: { flags, mode },
    updatedAt: null,
    updatedBy: null,
  });

beforeEach(() => {
  getLabsConfigMock.mockReset();
  getRoleMock.mockReset();
  updateLabsConfigMock.mockReset();
  getRoleMock.mockResolvedValue('admin');
  invalidateLabOverrides();
});
describe('orphan flags in the delivered payload', () => {
  it('never hands the client a lab key this build does not know', async () => {
    givenConfig('admin', { enableSelfLearning: true, [ORPHAN_FLAG]: true });

    const result = await resolveLabsForUserState(db, 'user-1', { enableSelfLearning: false });

    expect(result.lab).not.toHaveProperty(ORPHAN_FLAG);
    expect(result.lab?.enableSelfLearning).toBe(true);
    expect(result.labsMode).toBe('admin');
  });

  it('keeps user mode passing the stored row through without inspecting it', async () => {
    // Upstream owns the row in `user` mode; the console must not rewrite it,
    // not even to clean up a stale key.
    const storedLab = { enableSelfLearning: true, [ORPHAN_FLAG]: true };
    givenConfig('user');

    const result = await resolveLabsForUserState(db, 'user-1', storedLab);

    expect(result).toEqual({ lab: storedLab, labsMode: 'user' });
  });

  it('drops the orphan from the admin-mode effective lab', async () => {
    givenConfig('admin', { [ORPHAN_FLAG]: true });

    const effective = applyLabOverrides(undefined, await resolveLabOverrides(db));

    expect(effective).not.toHaveProperty(ORPHAN_FLAG);
  });

  it('rejects an unknown flag on write instead of storing a dead switch', async () => {
    // A read tolerates an orphan because an upgrade can orphan a stored key; a
    // write is a person typing, so a typo must fail loudly.
    givenConfig('user');
    getLabsConfigMock.mockResolvedValue({
      config: { flags: {}, mode: 'user' },
      updatedAt: null,
      updatedBy: null,
    });

    await expect(
      updateAdminLabsConfig(db, { flags: { [ORPHAN_FLAG]: true }, mode: 'admin' }, 'admin-1'),
    ).rejects.toThrow(ADMIN_CONSOLE_ERROR.invalidLabsConfig);

    expect(updateLabsConfigMock).not.toHaveBeenCalled();
  });
});

describe('lab registry follows upstream', () => {
  // The deployment registry is the upstream schema, not a copy of it: adding a
  // lab upstream must be enough for the console to store it.
  const schemaKeys = Object.keys(UserLabSchema.shape);

  it('knows every flag the upstream schema defines', () => {
    const unknown = schemaKeys.filter((flag) => !isKnownLabFlag(flag));

    expect(unknown, `UserLabSchema keys the resolver would drop: ${unknown.join(', ')}`).toEqual(
      [],
    );
  });

  it('keeps every upstream flag through sanitizing', () => {
    // The registry is the schema, so a full map must survive untouched: if a
    // flag were dropped here it would be stored by the admin write and then
    // silently vanish on read — a switch that appears to work and does not.
    const allTrue = Object.fromEntries(schemaKeys.map((flag) => [flag, true]));

    expect(Object.keys(sanitizeLabFlags(allTrue)).sort()).toEqual([...schemaKeys].sort());
  });

  it('sanitizes a map down to the schema keys', async () => {
    givenConfig('admin', { enableProjects: true, [ORPHAN_FLAG]: true });

    const { flags } = await resolveLabOverrides(db);

    expect(Object.keys(flags).sort()).toEqual(['enableProjects']);
  });
});
