'use client';

import {
  Button,
  Center,
  confirmModal,
  cssVar,
  Drawer,
  Flexbox,
  Select,
  Spin,
  Tag,
  Text,
  TextArea,
  toast,
} from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { adminConsoleService } from '@/services/adminConsole';
import { useUserStore } from '@/store/user';

import { useAdminUser } from '../hooks/useAdminUser';
import { formatDateTime, userDisplayName } from './utils';

interface UserDetailDrawerProps {
  onChanged: () => void;
  onClose: () => void;
  userId: string | null;
}

const DetailRow = memo<{ children: ReactNode; label: ReactNode }>(({ label, children }) => (
  <Flexbox
    horizontal
    align={'center'}
    gap={16}
    justify={'space-between'}
    style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`, paddingBlock: 10 }}
  >
    <Text fontSize={13} type={'secondary'}>
      {label}
    </Text>
    <Flexbox align={'flex-end'} style={{ minWidth: 0 }}>
      {children}
    </Flexbox>
  </Flexbox>
));

DetailRow.displayName = 'AdminUserDetailRow';

interface DetailContentProps {
  onChanged: () => void;
  onClose: () => void;
  userId: string;
}

const DetailContent = memo<DetailContentProps>(({ userId, onClose, onChanged }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { data: user, isLoading, mutate } = useAdminUser(userId);
  const currentUserId = useUserStore((state) => state.user?.id);
  const [reason, setReason] = useState('');
  const [banDays, setBanDays] = useState(0);
  const [pending, setPending] = useState(false);

  const refresh = async () => {
    await mutate();
    onChanged();
  };

  if (isLoading && !user) {
    return (
      <Center height={240}>
        <Spin />
      </Center>
    );
  }

  if (!user) return null;

  const isSelf = currentUserId === user.id;
  const name = userDisplayName(user);

  const runAction = async (action: () => Promise<unknown>, successText?: string) => {
    setPending(true);
    try {
      await action();
      if (successText) toast.success(successText);
      await refresh();
    } catch (error) {
      const message = (error as Error)?.message;
      if (message === 'LAST_ADMIN') {
        toast.error(t('adminConsole.users.error.lastAdmin'));
      } else if (message === 'SELF_LOCKOUT') {
        toast.error(t('adminConsole.users.error.selfLockout'));
      } else {
        toast.error(t('adminConsole.users.error.generic'));
      }
    } finally {
      setPending(false);
    }
  };

  const onToggleRole = () => {
    const nextRole = user.role === 'admin' ? 'user' : 'admin';
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t(
        nextRole === 'admin'
          ? 'adminConsole.users.confirm.setAdmin.content'
          : 'adminConsole.users.confirm.revokeAdmin.content',
      ),
      okText: t('adminConsole.users.action.confirm'),
      title: t(
        nextRole === 'admin'
          ? 'adminConsole.users.confirm.setAdmin.title'
          : 'adminConsole.users.confirm.revokeAdmin.title',
      ),
      onOk: () =>
        runAction(
          () => adminConsoleService.setUserRole(user.id, nextRole),
          t('adminConsole.users.action.saved'),
        ),
    });
  };

  const onRevokeSessions = () => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('adminConsole.users.confirm.revokeSessions.content'),
      okText: t('adminConsole.users.action.confirm'),
      title: t('adminConsole.users.confirm.revokeSessions.title'),
      onOk: () =>
        runAction(async () => {
          const { count } = await adminConsoleService.revokeUserSessions(user.id);
          toast.success(t('adminConsole.users.detail.revokedSessions', { count }));
        }),
    });
  };

  const onBan = () => {
    if (!reason.trim()) return;
    runAction(
      () =>
        adminConsoleService.banUser(
          user.id,
          reason.trim(),
          banDays > 0 ? dayjs().add(banDays, 'day').toDate() : undefined,
        ),
      t('adminConsole.users.action.saved'),
    );
  };

  return (
    <Flexbox gap={24}>
      <Flexbox horizontal align={'center'} gap={12}>
        <Avatar avatar={user.avatar} size={40} title={name} />
        <Flexbox>
          <Text weight={500}>{name}</Text>
          <Text fontSize={12} type={'secondary'}>
            {user.email ?? '—'}
          </Text>
        </Flexbox>
      </Flexbox>

      <Flexbox gap={4}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('adminConsole.users.detail.overview')}
        </Text>
        <DetailRow label={t('adminConsole.users.detail.account')}>
          <Text ellipsis>{user.username ?? '—'}</Text>
        </DetailRow>
        <DetailRow label={t('adminConsole.users.detail.role')}>
          <Tag color={user.role === 'admin' ? 'warning' : undefined} size={'small'}>
            {t(
              user.role === 'admin'
                ? 'adminConsole.users.role.admin'
                : 'adminConsole.users.role.user',
            )}
          </Tag>
        </DetailRow>
        <DetailRow label={t('adminConsole.users.detail.status')}>
          <Tag color={user.banned ? 'error' : 'success'} size={'small'}>
            {t(
              user.banned ? 'adminConsole.users.status.banned' : 'adminConsole.users.status.active',
            )}
          </Tag>
        </DetailRow>
        <DetailRow label={t('adminConsole.users.detail.emailVerified')}>
          <Text fontSize={13}>
            {t(
              user.emailVerified
                ? 'adminConsole.users.detail.verified'
                : 'adminConsole.users.detail.unverified',
            )}
          </Text>
        </DetailRow>
        <DetailRow label={t('adminConsole.users.detail.lastActive')}>
          <Text fontSize={13}>{formatDateTime(user.lastActiveAt)}</Text>
        </DetailRow>
        <DetailRow label={t('adminConsole.users.detail.createdAt')}>
          <Text fontSize={13}>{formatDateTime(user.createdAt)}</Text>
        </DetailRow>
        {user.banned && user.banReason && (
          <DetailRow label={t('adminConsole.users.detail.banReason')}>
            <Text align={'right'} fontSize={13}>
              {user.banReason}
            </Text>
          </DetailRow>
        )}
        {user.banned && user.banExpires && (
          <DetailRow label={t('adminConsole.users.detail.banExpires')}>
            <Text fontSize={13}>{formatDateTime(user.banExpires)}</Text>
          </DetailRow>
        )}
      </Flexbox>

      <Flexbox gap={8}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('adminConsole.users.detail.actions')}
        </Text>
        {isSelf && (
          <Text fontSize={12} type={'secondary'}>
            {t('adminConsole.users.detail.selfHint')}
          </Text>
        )}
        <Button block disabled={isSelf || pending} onClick={onToggleRole}>
          {t(
            user.role === 'admin'
              ? 'adminConsole.users.detail.revokeAdmin'
              : 'adminConsole.users.detail.setAdmin',
          )}
        </Button>

        {user.banned ? (
          <Button
            block
            disabled={pending}
            onClick={() =>
              runAction(
                () => adminConsoleService.unbanUser(user.id),
                t('adminConsole.users.action.saved'),
              )
            }
          >
            {t('adminConsole.users.detail.unban')}
          </Button>
        ) : (
          <Flexbox gap={8}>
            <TextArea
              placeholder={t('adminConsole.users.detail.banReasonPlaceholder')}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Flexbox horizontal align={'center'} gap={8}>
              <Text fontSize={12} style={{ whiteSpace: 'nowrap' }} type={'secondary'}>
                {t('adminConsole.users.detail.banDuration')}
              </Text>
              <Select
                size={'small'}
                style={{ minWidth: 120 }}
                value={banDays}
                options={[
                  { label: t('adminConsole.users.detail.banDuration.never'), value: 0 },
                  { label: t('adminConsole.users.detail.banDuration.oneDay'), value: 1 },
                  { label: t('adminConsole.users.detail.banDuration.sevenDays'), value: 7 },
                  { label: t('adminConsole.users.detail.banDuration.thirtyDays'), value: 30 },
                ]}
                onChange={(value) => setBanDays(Number(value))}
              />
            </Flexbox>
            <Button block danger disabled={isSelf || pending || !reason.trim()} onClick={onBan}>
              {t('adminConsole.users.detail.ban')}
            </Button>
          </Flexbox>
        )}

        <Button block disabled={pending} onClick={onRevokeSessions}>
          {t('adminConsole.users.detail.revokeSessions')}
        </Button>
      </Flexbox>

      <Button block onClick={onClose}>
        {t('close', { ns: 'common' })}
      </Button>
    </Flexbox>
  );
});

DetailContent.displayName = 'AdminUserDetailContent';

const UserDetailDrawer = memo<UserDetailDrawerProps>(({ userId, onClose, onChanged }) => {
  const { t } = useTranslation('setting');

  return (
    <Drawer
      open={Boolean(userId)}
      placement={'right'}
      title={t('adminConsole.users.title')}
      width={520}
      onClose={onClose}
    >
      {userId && <DetailContent userId={userId} onChanged={onChanged} onClose={onClose} />}
    </Drawer>
  );
});

UserDetailDrawer.displayName = 'AdminUserDetailDrawer';

export default UserDetailDrawer;
