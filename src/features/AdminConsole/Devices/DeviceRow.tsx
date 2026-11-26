import type { AdminDeviceSummary } from '@lobechat/types';
import { Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { useDensityTokens } from '@/styles/density';
import { sx } from '@/styles/sx';

import { platformIcon, platformLabel } from './platform';
import PresenceBadge from './PresenceBadge';
import { DEVICE_LIST_COLUMNS, styles } from './style';
import {
  deviceDisplayName,
  deviceSecondaryName,
  formatAbsolute,
  formatRelative,
  ownerDisplayName,
  ownerSecondaryName,
} from './utils';

interface DeviceRowProps {
  device: AdminDeviceSummary;
  onSelect: (device: AdminDeviceSummary) => void;
}

const DeviceRow = memo<DeviceRowProps>(({ device, onSelect }) => {
  const { t } = useTranslation('adminConsole');
  const tokens = useDensityTokens();

  const name = deviceDisplayName(device);
  const ownerName = ownerDisplayName(device.owner);
  const platformText = platformLabel(device.platform, device.architecture);
  const select = () => onSelect(device);

  return (
    <div
      {...sx(styles.row, {
        gridTemplateColumns: DEVICE_LIST_COLUMNS,
        minHeight: tokens.listRowHeight,
      })}
      aria-label={name}
      role={'button'}
      tabIndex={0}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      }}
    >
      <div {...stylex.props(styles.deviceCell)}>
        <span {...stylex.props(styles.deviceIcon)}>{platformIcon(device.platform, 18)}</span>
        <div {...stylex.props(styles.deviceText)}>
          <Text ellipsis weight={500}>
            {name}
          </Text>
          <Text ellipsis fontSize={12} type={'secondary'}>
            {deviceSecondaryName(device)}
          </Text>
        </div>
      </div>

      <div {...stylex.props(styles.ownerCell)}>
        <Avatar avatar={device.owner.avatar} name={ownerName} size={28} title={ownerName} />
        <div {...stylex.props(styles.ownerText)}>
          <Text ellipsis fontSize={13}>
            {ownerName}
          </Text>
          {device.workspace ? (
            <div {...stylex.props(styles.ownerCell)}>
              <Text ellipsis fontSize={12} type={'secondary'}>
                {device.workspace.name}
              </Text>
              {device.visibility && (
                <Tag color={device.visibility === 'public' ? 'blue' : 'default'} size={'small'}>
                  {t(`devices.visibility.${device.visibility}`)}
                </Tag>
              )}
            </div>
          ) : (
            <Text ellipsis fontSize={12} type={'secondary'}>
              {ownerSecondaryName(device.owner)}
            </Text>
          )}
        </div>
      </div>

      <div>
        <Tag color={device.scope === 'workspace' ? 'purple' : 'default'} size={'small'}>
          {t(`devices.scope.${device.scope}`)}
        </Tag>
      </div>

      <PresenceBadge state={device.online} />

      <Text ellipsis fontSize={13} type={'secondary'}>
        {platformText ?? '—'}
      </Text>

      <Tooltip title={formatAbsolute(device.lastSeenAt)}>
        <Text ellipsis fontSize={13} type={'secondary'}>
          {formatRelative(device.lastSeenAt)}
        </Text>
      </Tooltip>

      <Icon icon={ChevronRight} size={16} />
    </div>
  );
});

DeviceRow.displayName = 'AdminDeviceRow';

export default DeviceRow;
