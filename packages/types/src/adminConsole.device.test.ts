import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  AdminDeviceDetail,
  AdminDeviceDetailMetadataKey,
  AdminDeviceOnlineState,
  AdminDeviceSummary,
} from './adminConsole';
import { ADMIN_DEVICE_DETAIL_METADATA_KEYS, ADMIN_DEVICE_MAX_PAGE_SIZE } from './adminConsole';

/**
 * CUST-010 privacy contract, kept executable.
 *
 * The admin device overview must never hand an administrator another user's
 * filesystem paths or the raw `devices.metadata` blob. The contract lives in
 * the types; these assertions fail the moment a field is added back.
 */
describe('admin device privacy contract', () => {
  it('projects only the whitelisted metadata keys', () => {
    expect(ADMIN_DEVICE_DETAIL_METADATA_KEYS).toEqual(['appVersion', 'cliVersion']);
    expectTypeOf<AdminDeviceDetailMetadataKey>().toEqualTypeOf<'appVersion' | 'cliVersion'>();
  });

  it('caps the admin page size at 100', () => {
    expect(ADMIN_DEVICE_MAX_PAGE_SIZE).toBe(100);
  });

  it('keeps filesystem paths out of the summary and detail types', () => {
    expectTypeOf<
      'defaultCwd' extends keyof AdminDeviceDetail ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'workingDirs' extends keyof AdminDeviceDetail ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'recentCwds' extends keyof AdminDeviceDetail ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'defaultCwd' extends keyof AdminDeviceSummary ? true : false
    >().toEqualTypeOf<false>();
  });

  it('never exposes raw metadata as a whole object', () => {
    expectTypeOf<
      'metadata' extends keyof AdminDeviceDetail ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'metadata' extends keyof AdminDeviceSummary ? true : false
    >().toEqualTypeOf<false>();
  });

  it('models presence as three states instead of a boolean', () => {
    expectTypeOf<AdminDeviceSummary['online']>().toEqualTypeOf<AdminDeviceOnlineState>();
    expectTypeOf<AdminDeviceOnlineState>().toEqualTypeOf<'online' | 'offline' | 'unknown'>();
  });
});
