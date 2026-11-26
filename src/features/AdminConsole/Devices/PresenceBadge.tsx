import type { AdminDeviceOnlineState } from '@lobechat/types';
import { Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

const DOT_STYLE: Record<AdminDeviceOnlineState, stylex.StyleXStyles> = {
  offline: styles.dotOffline,
  online: styles.dotOnline,
  unknown: styles.dotUnknown,
};

interface PresenceBadgeProps {
  state: AdminDeviceOnlineState;
}

/**
 * Three-state presence. Always renders a text label next to the dot so the state
 * survives colour-blindness and greyscale screenshots, and `unknown` carries a
 * tooltip explaining that presence could not be determined.
 */
const PresenceBadge = memo<PresenceBadgeProps>(({ state }) => {
  const { t } = useTranslation('adminConsole');

  const body = (
    <div {...stylex.props(styles.presence)}>
      <span {...stylex.props(styles.presenceDot, DOT_STYLE[state])} />
      <span {...stylex.props(styles.presenceLabel)}>{t(`devices.online.${state}`)}</span>
    </div>
  );

  if (state !== 'unknown') return body;

  return (
    <Tooltip title={t('devices.online.unknownHint')}>
      <div {...stylex.props(styles.presenceUnknown)}>{body}</div>
    </Tooltip>
  );
});

PresenceBadge.displayName = 'AdminDevicePresenceBadge';

export default PresenceBadge;
