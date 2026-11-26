import SiApple from '@icons-pack/react-simple-icons/icons/SiApple';
import SiLinux from '@icons-pack/react-simple-icons/icons/SiLinux';
import { Microsoft } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { MonitorIcon } from 'lucide-react';

/**
 * Platform glyph for a device row.
 *
 * Deliberately local to the admin console instead of importing
 * `@/features/DeviceManager/getDeviceIcon`: the admin list must not depend on the
 * upstream device feature (that coupling is what CUST-010 avoids), and these few
 * lines are the whole mapping. Keep in sync if a new platform shows up.
 */
export const platformIcon = (platform: string | null | undefined, size = 18) => {
  switch (platform) {
    case 'darwin': {
      return <SiApple color="currentColor" size={size} />;
    }
    case 'linux': {
      return <SiLinux color="currentColor" size={size} />;
    }
    case 'win32': {
      return <Microsoft color="currentColor" size={size} />;
    }
    default: {
      return <Icon icon={MonitorIcon} size={size} />;
    }
  }
};

const PLATFORM_LABEL: Record<string, string> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

/** "macOS · arm64"; `undefined` when neither part is known. */
export const platformLabel = (
  platform: string | null | undefined,
  architecture: string | null | undefined,
) => {
  const os = platform ? (PLATFORM_LABEL[platform] ?? platform) : undefined;
  return [os, architecture].filter(Boolean).join(' · ') || undefined;
};
