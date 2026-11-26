import type { AdminDeviceSummary } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  buildDeviceListParams,
  DEFAULT_DEVICE_FILTERS,
  deviceDisplayName,
  deviceRowKey,
  deviceSecondaryName,
  hasActiveDeviceFilters,
  isDevicePagePartial,
  ownerDisplayName,
  PAGE_SIZE,
} from './utils';

const filters = (overrides: Partial<typeof DEFAULT_DEVICE_FILTERS> = {}) => ({
  ...DEFAULT_DEVICE_FILTERS,
  ...overrides,
});

describe('buildDeviceListParams', () => {
  it('sends nothing for the default view', () => {
    expect(buildDeviceListParams(filters())).toEqual({
      online: undefined,
      page: 1,
      pageSize: PAGE_SIZE,
      q: undefined,
      scope: undefined,
      visibility: undefined,
    });
  });

  it('trims the keyword and drops a blank one', () => {
    expect(buildDeviceListParams(filters({ keyword: '  mac-mini  ' })).q).toBe('mac-mini');
    expect(buildDeviceListParams(filters({ keyword: '   ' })).q).toBeUndefined();
  });

  it('drops visibility unless the scope is workspace', () => {
    // Visibility is a workspace-only dimension. Sending it under `personal` (or
    // `all`) can match no row at all, which reads as "no devices" to an admin.
    expect(buildDeviceListParams(filters({ visibility: 'public' })).visibility).toBeUndefined();
    expect(
      buildDeviceListParams(filters({ scope: 'personal', visibility: 'public' })).visibility,
    ).toBeUndefined();
    expect(
      buildDeviceListParams(filters({ scope: 'workspace', visibility: 'public' })).visibility,
    ).toBe('public');
  });

  it('passes through the three presence states, including unknown', () => {
    expect(buildDeviceListParams(filters({ online: 'online' })).online).toBe('online');
    expect(buildDeviceListParams(filters({ online: 'offline' })).online).toBe('offline');
    // `unknown` is a real filter value, not a synonym for offline.
    expect(buildDeviceListParams(filters({ online: 'unknown' })).online).toBe('unknown');
  });
});

describe('hasActiveDeviceFilters', () => {
  it('ignores whitespace-only keywords', () => {
    expect(hasActiveDeviceFilters(filters({ keyword: '   ' }))).toBe(false);
    expect(hasActiveDeviceFilters(filters({ keyword: 'x' }))).toBe(true);
  });

  it('counts every other filter', () => {
    expect(hasActiveDeviceFilters(filters({ scope: 'workspace' }))).toBe(true);
    expect(hasActiveDeviceFilters(filters({ online: 'unknown' }))).toBe(true);
    expect(hasActiveDeviceFilters(filters({ visibility: 'private' }))).toBe(true);
  });
});

describe('isDevicePagePartial', () => {
  it('is false without a presence filter', () => {
    // Presence narrowing is the only reason a page can come back short.
    expect(isDevicePagePartial(filters(), 5, 200)).toBe(false);
  });

  it('flags a short filtered page while total still counts every row', () => {
    expect(isDevicePagePartial(filters({ online: 'online' }), 3, 200)).toBe(true);
  });

  it('is false when the page is full or the result is smaller than a page', () => {
    expect(isDevicePagePartial(filters({ online: 'online' }), PAGE_SIZE, 200)).toBe(false);
    expect(isDevicePagePartial(filters({ online: 'online' }), 3, 3)).toBe(false);
  });
});

describe('device display helpers', () => {
  const base = {
    deviceId: 'dev-1',
    friendlyName: null,
    hostname: null,
  } as Pick<AdminDeviceSummary, 'deviceId' | 'friendlyName' | 'hostname'>;

  /** A personal row always carries its owner; the row key needs it. */
  const personal = {
    ...base,
    owner: { avatar: null, email: null, fullName: null, userId: 'user_1', username: null },
    scope: 'personal',
    workspace: null,
  } as AdminDeviceSummary;

  it('prefers the rename, then the hostname, then the id', () => {
    expect(deviceDisplayName({ ...base, friendlyName: 'Studio', hostname: 'mac-mini' })).toBe(
      'Studio',
    );
    expect(deviceDisplayName({ ...base, hostname: 'mac-mini' })).toBe('mac-mini');
    expect(deviceDisplayName(base)).toBe('dev-1');
  });

  it('shows the hostname as the secondary line only when the name was renamed', () => {
    expect(deviceSecondaryName({ ...base, friendlyName: 'Studio', hostname: 'mac-mini' })).toBe(
      'mac-mini',
    );
    expect(deviceSecondaryName({ ...base, hostname: 'mac-mini' })).toBe('dev-1');
  });

  it('names an owner by full name, then username, then email', () => {
    expect(
      ownerDisplayName({
        avatar: null,
        email: 'a@b.co',
        fullName: 'Ada',
        userId: 'u1',
        username: 'ada',
      }),
    ).toBe('Ada');
    expect(
      ownerDisplayName({
        avatar: null,
        email: 'a@b.co',
        fullName: null,
        userId: 'u1',
        username: 'ada',
      }),
    ).toBe('ada');
  });

  it('keys rows by (workspace, device) so a shared device appears twice', () => {
    const workspace = {
      ...base,
      scope: 'workspace',
      workspace: { name: 'Acme', workspaceId: 'ws-1' },
    } as AdminDeviceSummary;

    expect(deviceRowKey(personal)).toBe('personal:user_1::dev-1');
    expect(deviceRowKey(workspace)).toBe('ws-1::dev-1');
    expect(deviceRowKey(personal)).not.toBe(deviceRowKey(workspace));
  });

  it('keeps two owners apart when they pinned the same personal deviceId', () => {
    // `lh connect --device-id` pins an explicit id, so the "deviceId hashes in
    // the principal" assumption does not hold. A fixed `personal` placeholder
    // collapsed both rows into one React key and one detail cache entry.
    const bob = {
      ...personal,
      owner: { ...personal.owner, userId: 'user_2' },
    } as AdminDeviceSummary;

    expect(deviceRowKey(personal)).not.toBe(deviceRowKey(bob));
  });
});
