'use client';

import { ADMIN_CONSOLE_ERROR } from '@lobechat/types';
import {
  Button,
  Center,
  confirmModal,
  cssVar,
  Drawer,
  Flexbox,
  Input,
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
  const { t } = useTranslation(['adminConsole', 'common']);
  const { data: user, isLoading, mutate } = useAdminUser(userId);
  const currentUserId = useUserStore((state) => state.user?.id);
  const [reason, setReason] = useState('');
  const [banDays, setBanDays] = useState(0);
  const [pending, setPending] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

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
        toast.error(t('users.error.lastAdmin'));
      } else if (message === 'SELF_LOCKOUT') {
        toast.error(t('users.error.selfLockout'));
      } else {
        toast.error(t('users.error.generic'));
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
          ? 'users.confirm.setAdmin.content'
          : 'users.confirm.revokeAdmin.content',
      ),
      okText: t('users.action.confirm'),
      title: t(
        nextRole === 'admin' ? 'users.confirm.setAdmin.title' : 'users.confirm.revokeAdmin.title',
      ),
      onOk: () =>
        runAction(
          () => adminConsoleService.setUserRole(user.id, nextRole),
          t('users.action.saved'),
        ),
    });
  };

  const onRevokeSessions = () => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('users.confirm.revokeSessions.content'),
      okText: t('users.action.confirm'),
      title: t('users.confirm.revokeSessions.title'),
      onOk: () =>
        runAction(async () => {
          const { count } = await adminConsoleService.revokeUserSessions(user.id);
          toast.success(t('users.detail.revokedSessions', { count }));
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
      t('users.action.saved'),
    );
  };

  /** What the admin has to retype: the login account, else the email. */
  const deleteAccountLabel = user.username ?? user.email ?? user.id;
  const canDelete = !isSelf && user.role !== 'admin';
  const deleteConfirmed = deleteConfirmText.trim() === deleteAccountLabel;

  const deleteErrorText = (error: unknown) => {
    const message = (error as Error)?.message;
    if (message === ADMIN_CONSOLE_ERROR.adminProtected) return t('users.delete.error.admin');
    if (message === ADMIN_CONSOLE_ERROR.selfLockout) return t('users.error.selfLockout');
    if (message === ADMIN_CONSOLE_ERROR.agentTransferPending) {
      return t('users.delete.error.transferPending');
    }
    return t('users.error.generic');
  };

  const onDelete = () => {
    if (!canDelete || !deleteConfirmed) return;

    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('users.delete.confirmContent', { name }),
      okButtonProps: { danger: true },
      okText: t('users.delete.confirmOk'),
      title: t('users.delete.confirmTitle'),
      onOk: async () => {
        setPending(true);
        try {
          const result = await adminConsoleService.deleteUser(user.id);
          toast.success(t('users.delete.success', { files: result.deletedFiles }));
          // The row is gone: refresh the list, do not re-fetch the profile.
          onChanged();
          onClose();
        } catch (error) {
          toast.error(deleteErrorText(error));
        } finally {
          setPending(false);
        }
      },
    });
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
          {t('users.detail.overview')}
        </Text>
        <DetailRow label={t('users.detail.account')}>
          <Text ellipsis>{user.username ?? '—'}</Text>
        </DetailRow>
        <DetailRow label={t('users.detail.role')}>
          <Tag color={user.role === 'admin' ? 'warning' : undefined} size={'small'}>
            {t(user.role === 'admin' ? 'users.role.admin' : 'users.role.user')}
          </Tag>
        </DetailRow>
        <DetailRow label={t('users.detail.status')}>
          <Tag color={user.banned ? 'error' : 'success'} size={'small'}>
            {t(user.banned ? 'users.status.banned' : 'users.status.active')}
          </Tag>
        </DetailRow>
        <DetailRow label={t('users.detail.emailVerified')}>
          <Text fontSize={13}>
            {t(user.emailVerified ? 'users.detail.verified' : 'users.detail.unverified')}
          </Text>
        </DetailRow>
        <DetailRow label={t('users.detail.lastActive')}>
          <Text fontSize={13}>{formatDateTime(user.lastActiveAt)}</Text>
        </DetailRow>
        <DetailRow label={t('users.detail.createdAt')}>
          <Text fontSize={13}>{formatDateTime(user.createdAt)}</Text>
        </DetailRow>
        {user.banned && user.banReason && (
          <DetailRow label={t('users.detail.banReason')}>
            <Text align={'right'} fontSize={13}>
              {user.banReason}
            </Text>
          </DetailRow>
        )}
        {user.banned && user.banExpires && (
          <DetailRow label={t('users.detail.banExpires')}>
            <Text fontSize={13}>{formatDateTime(user.banExpires)}</Text>
          </DetailRow>
        )}
      </Flexbox>

      <Flexbox gap={8}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('users.detail.actions')}
        </Text>
        {isSelf && (
          <Text fontSize={12} type={'secondary'}>
            {t('users.detail.selfHint')}
          </Text>
        )}
        <Button block disabled={isSelf || pending} onClick={onToggleRole}>
          {t(user.role === 'admin' ? 'users.detail.revokeAdmin' : 'users.detail.setAdmin')}
        </Button>

        {user.banned ? (
          <Button
            block
            disabled={pending}
            onClick={() =>
              runAction(() => adminConsoleService.unbanUser(user.id), t('users.action.saved'))
            }
          >
            {t('users.detail.unban')}
          </Button>
        ) : (
          <Flexbox gap={8}>
            <TextArea
              placeholder={t('users.detail.banReasonPlaceholder')}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Flexbox horizontal align={'center'} gap={8}>
              <Text fontSize={12} style={{ whiteSpace: 'nowrap' }} type={'secondary'}>
                {t('users.detail.banDuration')}
              </Text>
              <Select
                size={'small'}
                style={{ minWidth: 120 }}
                value={banDays}
                options={[
                  { label: t('users.detail.banDuration.never'), value: 0 },
                  { label: t('users.detail.banDuration.oneDay'), value: 1 },
                  { label: t('users.detail.banDuration.sevenDays'), value: 7 },
                  { label: t('users.detail.banDuration.thirtyDays'), value: 30 },
                ]}
                onChange={(value) => setBanDays(Number(value))}
              />
            </Flexbox>
            <Button block danger disabled={isSelf || pending || !reason.trim()} onClick={onBan}>
              {t('users.detail.ban')}
            </Button>
          </Flexbox>
        )}

        <Button block disabled={pending} onClick={onRevokeSessions}>
          {t('users.detail.revokeSessions')}
        </Button>
      </Flexbox>

      <Flexbox gap={8}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('users.delete.section')}
        </Text>
        {!canDelete ? (
          <Text fontSize={12} type={'secondary'}>
            {t(isSelf ? 'users.delete.selfHint' : 'users.delete.adminHint')}
          </Text>
        ) : (
          <>
            <Text fontSize={12} type={'secondary'}>
              {t('users.delete.hint', { account: deleteAccountLabel })}
            </Text>
            <Input
              placeholder={deleteAccountLabel}
              value={deleteConfirmText}
              onChange={(event) => setDeleteConfirmText(event.target.value)}
            />
            <Button block danger disabled={pending || !deleteConfirmed} onClick={onDelete}>
              {t('users.delete.button')}
            </Button>
          </>
        )}
      </Flexbox>

      <Button block onClick={onClose}>
        {t('close', { ns: 'common' })}
      </Button>
    </Flexbox>
  );
});

DetailContent.displayName = 'AdminUserDetailContent';

const UserDetailDrawer = memo<UserDetailDrawerProps>(({ userId, onClose, onChanged }) => {
  const { t } = useTranslation('adminConsole');

  return (
    <Drawer
      open={Boolean(userId)}
      placement={'right'}
      title={t('users.title')}
      width={520}
      onClose={onClose}
    >
      {userId && <DetailContent userId={userId} onChanged={onChanged} onClose={onClose} />}
    </Drawer>
  );
});

UserDetailDrawer.displayName = 'AdminUserDetailDrawer';

export default UserDetailDrawer;
