import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  AdminDeviceDetail,
  AdminDeviceDetailMetadataKey,
  AdminDeviceOnlineState,
  AdminDeviceSummary,
} from './adminConsole';
import { ADMIN_DEVICE_DETAIL_METADATA_KEYS, ADMIN_DEVICE_MAX_PAGE_SIZE } from './adminConsole';

/**
 * CUST-010 device privacy contract, kept executable.
 *
 * The boundary is asymmetric by design:
 * - the LIST (`AdminDeviceSummary`) must never carry another user's filesystem
 *   paths or the raw `devices.metadata` blob;
 * - the DETAIL (`AdminDeviceDetail`) mirrors the owner's own device page, so it
 *   DOES carry `defaultCwd` / `workingDirs` — the decision that lets an
 *   administrator verify a machine end to end (see CUSTOMIZATIONS.md).
 *
 * `recentCwds` stays out of both: the column is deprecated and no longer read.
 */
describe('admin device privacy contract', () => {
  it('projects only the whitelisted metadata keys', () => {
    expect(ADMIN_DEVICE_DETAIL_METADATA_KEYS).toEqual(['appVersion', 'cliVersion']);
    expectTypeOf<AdminDeviceDetailMetadataKey>().toEqualTypeOf<'appVersion' | 'cliVersion'>();
  });

  it('caps the admin page size at 100', () => {
    expect(ADMIN_DEVICE_MAX_PAGE_SIZE).toBe(100);
  });

  it('keeps filesystem paths out of the admin list', () => {
    expectTypeOf<
      'defaultCwd' extends keyof AdminDeviceSummary ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'workingDirs' extends keyof AdminDeviceSummary ? true : false
    >().toEqualTypeOf<false>();
  });

  it('exposes the owner-visible directories on the detail only', () => {
    expectTypeOf<
      'defaultCwd' extends keyof AdminDeviceDetail ? true : false
    >().toEqualTypeOf<true>();
    expectTypeOf<
      'workingDirs' extends keyof AdminDeviceDetail ? true : false
    >().toEqualTypeOf<true>();
  });

  it('never exposes the deprecated recentCwds column', () => {
    expectTypeOf<
      'recentCwds' extends keyof AdminDeviceDetail ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      'recentCwds' extends keyof AdminDeviceSummary ? true : false
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
