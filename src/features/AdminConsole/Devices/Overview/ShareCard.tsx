'use client';

import type { AdminDeviceDetail, AdminDeviceTarget } from '@lobechat/types';
import { Button, Flexbox, Icon, Select, Tag, Text, toast } from '@lobehub/ui';
import { Share2Icon, TrashIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { adminConsoleService } from '@/services/adminConsole';

import { useAdminDeviceShares } from '../../hooks/useAdminDevices';
import { useAdminWorkspaces } from '../../hooks/useAdminWorkspaces';
import { DetailCard } from './cards';

/** Share a personal device from the console — the one write the detail page offers. */
export const ShareCard = ({
  device,
  target,
}: {
  device: AdminDeviceDetail;
  target: AdminDeviceTarget;
}) => {
  const { t } = useTranslation('adminConsole');
  const { data: shares, mutate } = useAdminDeviceShares(target);
  const { data: workspaces } = useAdminWorkspaces({ page: 1 });
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [busy, setBusy] = useState(false);

  const options =
    workspaces?.items
      .filter((workspace) => !shares?.some((share) => share.workspaceId === workspace.id))
      .map((workspace) => ({ label: workspace.name, value: workspace.id })) ?? [];

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await mutate();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DetailCard padded icon={Share2Icon} title={t('devices.detail.shares')}>
      {device.scope !== 'personal' ? (
        <Text type={'secondary'}>{t('devices.detail.sharesPersonalOnly')}</Text>
      ) : (
        <Flexbox gap={12}>
          <Flexbox horizontal gap={8}>
            <Select
              options={options}
              placeholder={t('devices.detail.sharePlaceholder')}
              style={{ flex: 1 }}
              value={workspaceId}
              onChange={(value) => setWorkspaceId(value as string)}
            />
            <Button
              disabled={!workspaceId}
              loading={busy}
              onClick={() =>
                run(async () => {
                  await adminConsoleService.shareDeviceToWorkspace({
                    deviceId: target.deviceId,
                    ownerId: target.ownerId!,
                    workspaceId: workspaceId!,
                  });
                  setWorkspaceId(undefined);
                })
              }
            >
              {t('devices.detail.shareAction')}
            </Button>
          </Flexbox>

          <Text type={'secondary'}>{t('devices.detail.shareHint')}</Text>

          {!shares?.length ? (
            <Text type={'secondary'}>{t('devices.detail.sharesEmpty')}</Text>
          ) : (
            shares.map((share) => (
              <Flexbox
                horizontal
                align={'center'}
                justify={'space-between'}
                key={share.workspaceId}
              >
                <Text>{share.workspaceName ?? share.workspaceId}</Text>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Tag color={'gold'}>{t('devices.detail.sharedByAdminTag')}</Tag>
                  <Button
                    icon={<Icon icon={TrashIcon} />}
                    loading={busy}
                    size={'small'}
                    type={'text'}
                    onClick={() =>
                      run(() =>
                        adminConsoleService.revokeDeviceShare({
                          deviceId: target.deviceId,
                          ownerId: target.ownerId!,
                          workspaceId: share.workspaceId,
                        }),
                      )
                    }
                  />
                </Flexbox>
              </Flexbox>
            ))
          )}
        </Flexbox>
      )}
    </DetailCard>
  );
};
