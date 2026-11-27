// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { assertNotAdminShare } from './workspace';

describe('admin-share guard', () => {
  it('blocks member-side removal and visibility changes for console shares', () => {
    for (const action of ['removed', 'hidden', 'overwritten']) {
      expect(() => assertNotAdminShare({ shareOrigin: 'admin' }, action)).toThrowError(
        /shared by an administrator/,
      );
    }
  });

  it('leaves member-enrolled rows alone', () => {
    expect(() => assertNotAdminShare({ shareOrigin: 'user' }, 'removed')).not.toThrow();
    expect(() => assertNotAdminShare({ shareOrigin: null }, 'removed')).not.toThrow();
    expect(() => assertNotAdminShare({}, 'removed')).not.toThrow();
  });
});
