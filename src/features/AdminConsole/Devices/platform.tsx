import SiAndroid from '@icons-pack/react-simple-icons/icons/SiAndroid';
import SiApple from '@icons-pack/react-simple-icons/icons/SiApple';
import SiIos from '@icons-pack/react-simple-icons/icons/SiIos';
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
 *
 * Upstream registers mobile devices as `android` / `ios` (`apps/cli/src/device/
 * platform.ts`), so the ledger maps them explicitly instead of falling back to
 * the generic monitor glyph. Their build metadata (`androidVersion` /
 * `deviceModel`) stays out of the admin projection — CUST-010's privacy
 * whitelist only lets `appVersion` / `cliVersion` through.
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
    case 'android': {
      return <SiAndroid color="currentColor" size={size} />;
    }
    case 'ios': {
      return <SiIos color="currentColor" size={size} />;
    }
    default: {
      return <Icon icon={MonitorIcon} size={size} />;
    }
  }
};

const PLATFORM_LABEL: Record<string, string> = {
  android: 'Android',
  darwin: 'macOS',
  ios: 'iOS',
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
