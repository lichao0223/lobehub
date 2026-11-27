import SiAndroid from '@icons-pack/react-simple-icons/icons/SiAndroid';
import SiIos from '@icons-pack/react-simple-icons/icons/SiIos';
import { describe, expect, it } from 'vitest';

import { platformIcon, platformLabel } from './platform';

describe('admin device platform mapping', () => {
  it('labels the mobile platforms the CLI registers', () => {
    expect(platformLabel('android', 'arm64')).toBe('Android · arm64');
    expect(platformLabel('ios', null)).toBe('iOS');
  });

  it('uses a mobile glyph instead of the generic monitor', () => {
    expect((platformIcon('android', 18) as any).type).toBe(SiAndroid);
    expect((platformIcon('ios', 18) as any).type).toBe(SiIos);
  });

  it('keeps an unknown platform readable', () => {
    expect(platformLabel('freebsd', 'x64')).toBe('freebsd · x64');
  });
});
