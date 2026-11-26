'use client';

import {
  Button,
  Center,
  CopyButton,
  cssVar,
  Drawer,
  Empty,
  Flexbox,
  Spin,
  Tag,
  Text,
} from '@lobehub/ui';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';

import { useAdminDevice } from '../hooks/useAdminDevices';
import {
  CHANNEL_LABEL_KEYS,
  describeDeviceLoadError,
  MANAGED_PHASE_COLOR,
  MANAGED_PHASE_KEYS,
  projectDeviceDetail,
} from './detail';
import { platformIcon, platformLabel } from './platform';
import PresenceBadge from './PresenceBadge';
import type { DeviceSelection } from './utils';
import {
  EMPTY_VALUE,
  formatAbsolute,
  formatRelative,
  ownerDisplayName,
  ownerSecondaryName,
} from './utils';

const MONO_STYLE = { fontFamily: cssVar.fontFamilyCode, wordBreak: 'break-all' } as const;

interface DeviceDetailDrawerProps {
  onClose: () => void;
  /** Identity of the open row: the same `deviceId` may exist in two pools. */
  selected: DeviceSelection | null;
}

const DetailRow = ({ children, label }: { children: ReactNode; label: ReactNode }) => (
  <Flexbox
    horizontal
    align={'center'}
    gap={16}
    justify={'space-between'}
    style={{
      borderBlockEndColor: cssVar.colorBorderSecondary,
      borderBlockEndStyle: 'solid',
      borderBlockEndWidth: 1,
      paddingBlock: 10,
    }}
  >
    <Text fontSize={13} type={'secondary'}>
      {label}
    </Text>
    <Flexbox align={'flex-end'} style={{ minWidth: 0 }}>
      {children}
    </Flexbox>
  </Flexbox>
);

const Section = ({ children, title }: { children: ReactNode; title: ReactNode }) => (
  <Flexbox gap={4}>
    <Text fontSize={12} type={'secondary'} weight={500}>
      {title}
    </Text>
    {children}
  </Flexbox>
);

interface DetailContentProps extends DeviceSelection {
  onClose: () => void;
}

const DetailContent = memo<DetailContentProps>(({ deviceId, ownerId, workspaceId, onClose }) => {
  const { t } = useTranslation(['adminConsole', 'common', 'setting']);
  const { data: device, error, isLoading, mutate } = useAdminDevice(deviceId, workspaceId, ownerId);

  if (isLoading && !device) {
    return (
      <Center height={240}>
        <Spin />
      </Center>
    );
  }

  if (!device) {
    if (!error) return null;

    const failure = describeDeviceLoadError(error);

    return (
      <Empty
        description={t(failure.descriptionKey)}
        title={t(failure.titleKey)}
        action={
          failure.canRetry ? (
            <Button onClick={() => void mutate()}>{t('devices.empty.retry')}</Button>
          ) : undefined
        }
      />
    );
  }

  const view = projectDeviceDetail(device);
  const ownerName = ownerDisplayName(view.ownership.owner);

  return (
    <Flexbox gap={24}>
      <Flexbox horizontal align={'center'} gap={12}>
        <Flexbox align={'center'} style={{ color: cssVar.colorTextSecondary }}>
          {platformIcon(view.device.platform, 24)}
        </Flexbox>
        <Flexbox style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {view.device.name}
          </Text>
          <Text ellipsis fontSize={12} type={'secondary'}>
            {view.device.secondaryName}
          </Text>
        </Flexbox>
      </Flexbox>

      <Section title={t('devices.detail.ownership')}>
        <DetailRow label={t('devices.detail.owner')}>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <Avatar
              avatar={view.ownership.owner.avatar}
              name={ownerName}
              size={28}
              title={ownerName}
            />
            <Flexbox style={{ minWidth: 0 }}>
              <Text ellipsis fontSize={13}>
                {ownerName}
              </Text>
              <Text ellipsis fontSize={12} type={'secondary'}>
                {ownerSecondaryName(view.ownership.owner)}
              </Text>
            </Flexbox>
          </Flexbox>
        </DetailRow>
        <DetailRow label={t('devices.detail.scope')}>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <Tag color={view.ownership.scope === 'workspace' ? 'purple' : 'default'} size={'small'}>
              {t(`devices.scope.${view.ownership.scope}`)}
            </Tag>
            {view.ownership.workspaceName && (
              <Text ellipsis fontSize={13}>
                {view.ownership.workspaceName}
              </Text>
            )}
          </Flexbox>
        </DetailRow>
        <DetailRow label={t('devices.detail.visibility')}>
          {view.ownership.visibility ? (
            <Tag color={view.ownership.visibility === 'public' ? 'blue' : 'default'} size={'small'}>
              {t(`devices.visibility.${view.ownership.visibility}`)}
            </Tag>
          ) : (
            <Text fontSize={13}>{EMPTY_VALUE}</Text>
          )}
        </DetailRow>
        {view.ownership.sharedFromDeviceId && (
          <DetailRow label={t('devices.detail.sharedFrom')}>
            <Flexbox align={'flex-end'} gap={2} style={{ minWidth: 0 }}>
              <Text align={'right'} fontSize={13} style={MONO_STYLE}>
                {view.ownership.sharedFromDeviceId}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {t('devices.detail.sharedFromHint')}
              </Text>
            </Flexbox>
          </DetailRow>
        )}
      </Section>

      <Section title={t('devices.detail.device')}>
        <DetailRow label={t('devices.detail.friendlyName')}>
          <Text fontSize={13}>{view.device.friendlyName}</Text>
        </DetailRow>
        <DetailRow label={t('devices.detail.hostname')}>
          <Text fontSize={13}>{view.device.hostname}</Text>
        </DetailRow>
        <DetailRow label={t('devices.detail.deviceId')}>
          <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
            <Text align={'right'} fontSize={13} style={MONO_STYLE}>
              {view.device.deviceId}
            </Text>
            <CopyButton content={view.device.deviceId} size={'small'} />
          </Flexbox>
        </DetailRow>
        <DetailRow label={t('devices.detail.platform')}>
          <Flexbox horizontal align={'center'} gap={6}>
            {platformIcon(view.device.platform, 14)}
            <Text fontSize={13}>{platformLabel(view.device.platform, null) ?? EMPTY_VALUE}</Text>
          </Flexbox>
        </DetailRow>
        <DetailRow label={t('devices.detail.architecture')}>
          <Text fontSize={13}>{view.device.architecture || EMPTY_VALUE}</Text>
        </DetailRow>
        <DetailRow label={t('devices.detail.identitySource')}>
          <Text fontSize={13}>{view.device.identitySource}</Text>
        </DetailRow>
      </Section>

      <Section title={t('devices.detail.connection')}>
        <DetailRow label={t('devices.detail.presence')}>
          <PresenceBadge state={view.connection.online} />
        </DetailRow>
        <DetailRow label={t('devices.detail.channels')}>
          {view.connection.channels.length === 0 ? (
            <Text fontSize={13}>{EMPTY_VALUE}</Text>
          ) : (
            <Flexbox gap={6} style={{ minWidth: 0 }}>
              {view.connection.channels.map((channel, index) => (
                <Flexbox
                  align={'flex-end'}
                  key={`${channel.channel ?? 'unknown'}-${index}`}
                  style={{ minWidth: 0 }}
                >
                  <Text ellipsis fontSize={13}>
                    {channel.channel ?? t(CHANNEL_LABEL_KEYS.unknown, { ns: 'setting' })}
                  </Text>
                  <Text fontSize={12} type={'secondary'}>
                    {t(CHANNEL_LABEL_KEYS.connected, {
                      ns: 'setting',
                      time: formatRelative(channel.connectedAt),
                    })}
                  </Text>
                </Flexbox>
              ))}
            </Flexbox>
          )}
        </DetailRow>
        {view.connection.managedPhase && (
          <DetailRow label={t('devices.detail.managedPhase')}>
            <Tag color={MANAGED_PHASE_COLOR[view.connection.managedPhase]} size={'small'}>
              {t(MANAGED_PHASE_KEYS[view.connection.managedPhase])}
            </Tag>
          </DetailRow>
        )}
      </Section>

      <Section title={t('devices.detail.version')}>
        <DetailRow label={t('devices.detail.appVersion')}>
          <Text fontSize={13} style={{ fontFamily: cssVar.fontFamilyCode }}>
            {view.version.appVersion}
          </Text>
        </DetailRow>
        <DetailRow label={t('devices.detail.cliVersion')}>
          <Text fontSize={13} style={{ fontFamily: cssVar.fontFamilyCode }}>
            {view.version.cliVersion}
          </Text>
        </DetailRow>
      </Section>

      <Section title={t('devices.detail.binding')}>
        <DetailRow label={t('devices.detail.binding.label')}>
          {view.binding.hasFixedAgentBinding ? (
            <Tag color={'warning'} size={'small'}>
              {t('devices.detail.binding.fixed')}
            </Tag>
          ) : (
            <Text fontSize={13}>{EMPTY_VALUE}</Text>
          )}
        </DetailRow>
        {view.binding.hasFixedAgentBinding && (
          <Text fontSize={12} type={'secondary'}>
            {t('devices.detail.binding.hint')}
          </Text>
        )}
      </Section>

      <Section title={t('devices.detail.timeline')}>
        <DetailRow label={t('devices.detail.firstSeenAt')}>
          <Text fontSize={13}>{formatAbsolute(view.timeline.firstSeenAt)}</Text>
        </DetailRow>
        <DetailRow label={t('devices.detail.lastSeenAt')}>
          <Flexbox align={'flex-end'}>
            <Text fontSize={13}>{formatAbsolute(view.timeline.lastSeenAt)}</Text>
            <Text fontSize={12} type={'secondary'}>
              {formatRelative(view.timeline.lastSeenAt)}
            </Text>
          </Flexbox>
        </DetailRow>
      </Section>

      <Button block onClick={onClose}>
        {t('close', { ns: 'common' })}
      </Button>
    </Flexbox>
  );
});

DetailContent.displayName = 'AdminDeviceDetailContent';

const DeviceDetailDrawer = memo<DeviceDetailDrawerProps>(({ selected, onClose }) => {
  const { t } = useTranslation('adminConsole');

  return (
    <Drawer
      open={Boolean(selected)}
      placement={'right'}
      title={t('devices.detail.title')}
      width={520}
      onClose={onClose}
    >
      {selected && (
        <DetailContent
          deviceId={selected.deviceId}
          ownerId={selected.ownerId}
          workspaceId={selected.workspaceId}
          onClose={onClose}
        />
      )}
    </Drawer>
  );
});

DeviceDetailDrawer.displayName = 'AdminDeviceDetailDrawer';

export default DeviceDetailDrawer;
