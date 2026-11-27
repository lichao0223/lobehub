'use client';

import type { AdminWorkspaceListItem } from '@lobechat/types';
import {
  Button,
  Center,
  createModal,
  Drawer,
  Empty,
  Flexbox,
  Icon,
  Input,
  Pagination,
  SearchBar,
  Select,
  Spin,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PlusIcon, TrashIcon, UserPlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { adminConsoleService } from '@/services/adminConsole';
import { useDensityTokens } from '@/styles/density';

import { useAdminWorkspaceMembers, useAdminWorkspaces } from '../hooks/useAdminWorkspaces';

const styles = stylex.create({
  row: {
    alignItems: 'center',
    borderColor: cssVar.colorBorderSecondary,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 8,
    cursor: 'pointer',
    display: 'flex',
    gap: 16,
    justifyContent: 'space-between',
    paddingBlock: 12,
    paddingInline: 16,
  },
});

const CreateWorkspaceForm = memo<{ onCreated: () => void }>(({ onCreated }) => {
  const { t } = useTranslation('adminConsole');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <Flexbox gap={12} padding={16}>
      <Text>{t('workspaces.name')}</Text>
      <Input
        placeholder={t('workspaces.namePlaceholder')}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        loading={loading}
        type={'primary'}
        onClick={async () => {
          if (!name.trim()) return;
          setLoading(true);
          try {
            await adminConsoleService.createWorkspace({ name: name.trim() });
            toast.success(t('workspaces.created'));
            onCreated();
          } catch (error) {
            toast.error((error as Error).message);
          } finally {
            setLoading(false);
          }
        }}
      >
        {t('workspaces.createOk')}
      </Button>
    </Flexbox>
  );
});

CreateWorkspaceForm.displayName = 'AdminCreateWorkspaceForm';

const MembersDrawer = memo<{ onClose: () => void; workspace: AdminWorkspaceListItem | null }>(
  ({ onClose, workspace }) => {
    const { t } = useTranslation('adminConsole');
    const { data, isLoading, mutate } = useAdminWorkspaceMembers(workspace?.id ?? null);
    const [identity, setIdentity] = useState('');
    const [role, setRole] = useState<'admin' | 'member'>('member');
    const [busy, setBusy] = useState(false);

    const workspaceId = workspace?.id;

    return (
      <Drawer
        open={Boolean(workspace)}
        placement={'right'}
        title={workspace ? t('workspaces.membersTitle', { name: workspace.name }) : ''}
        width={560}
        onClose={onClose}
      >
        {workspace && (
          <Flexbox gap={16} padding={16}>
            <Flexbox horizontal gap={8}>
              <Input
                placeholder={t('workspaces.memberPlaceholder')}
                value={identity}
                onChange={(event) => setIdentity(event.target.value)}
              />
              <Select
                value={role}
                options={[
                  { label: t('workspaces.role.member'), value: 'member' },
                  { label: t('workspaces.role.admin'), value: 'admin' },
                ]}
                onChange={(value) => setRole(value as 'admin' | 'member')}
              />
              <Button
                icon={<Icon icon={UserPlusIcon} />}
                loading={busy}
                onClick={async () => {
                  if (!identity.trim() || !workspaceId) return;
                  setBusy(true);
                  try {
                    await adminConsoleService.addWorkspaceMember({
                      identity: identity.trim(),
                      role,
                      workspaceId,
                    });
                    setIdentity('');
                    await mutate();
                  } catch (error) {
                    toast.error((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('workspaces.add')}
              </Button>
            </Flexbox>

            {isLoading ? (
              <Center style={{ padding: 24 }}>
                <Spin />
              </Center>
            ) : !data?.length ? (
              <Empty description={t('workspaces.noMembers')} />
            ) : (
              <Flexbox gap={8}>
                {data.map((member) => (
                  <Flexbox
                    horizontal
                    align={'center'}
                    gap={8}
                    justify={'space-between'}
                    key={member.userId}
                  >
                    <Flexbox>
                      <Text weight={500}>
                        {member.fullName || member.username || member.userId}
                      </Text>
                      <Text type={'secondary'}>{member.email}</Text>
                    </Flexbox>
                    <Flexbox horizontal align={'center'} gap={8}>
                      <Tag color={member.role === 'owner' ? 'gold' : 'default'}>
                        {t(`workspaces.role.${member.role}`)}
                      </Tag>
                      {member.role !== 'owner' && (
                        <Button
                          icon={<Icon icon={TrashIcon} />}
                          size={'small'}
                          type={'text'}
                          onClick={async () => {
                            try {
                              await adminConsoleService.removeWorkspaceMember({
                                userId: member.userId,
                                workspaceId: workspace.id,
                              });
                              await mutate();
                            } catch (error) {
                              toast.error((error as Error).message);
                            }
                          }}
                        />
                      )}
                    </Flexbox>
                  </Flexbox>
                ))}
              </Flexbox>
            )}
          </Flexbox>
        )}
      </Drawer>
    );
  },
);

MembersDrawer.displayName = 'AdminWorkspaceMembersDrawer';

const Workspaces = memo(() => {
  const { t } = useTranslation('adminConsole');
  const tokens = useDensityTokens();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<AdminWorkspaceListItem | null>(null);
  const { data, isLoading, mutate } = useAdminWorkspaces({ page, q });

  const openCreate = () => {
    createModal({
      content: <CreateWorkspaceForm onCreated={() => mutate()} />,
      footer: null,
      title: t('workspaces.createTitle'),
    });
  };

  return (
    <>
      <NavHeader>
        <Text weight={500}>{t('workspaces.title')}</Text>
      </NavHeader>
      <SettingContainer
        maxWidth={1024}
        paddingBlock={`${tokens.pagePaddingBlockStart}px 128px`}
        paddingInline={tokens.pagePaddingInline}
      >
        <Flexbox gap={16}>
          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
            <SearchBar
              allowClear
              placeholder={t('workspaces.searchPlaceholder')}
              style={{ flex: '1 1 220px', maxWidth: 320, minWidth: 220 }}
              value={q}
              variant={'filled'}
              onInputChange={(value) => {
                setQ(value);
                setPage(1);
              }}
            />
            <Button icon={<Icon icon={PlusIcon} />} type={'primary'} onClick={openCreate}>
              {t('workspaces.create')}
            </Button>
          </Flexbox>

          <Text fontSize={12} type={'secondary'}>
            {t('workspaces.membersHint')}
          </Text>

          {isLoading ? (
            <Center height={240}>
              <Spin />
            </Center>
          ) : !data?.items?.length ? (
            <Empty
              description={t('workspaces.empty')}
              title={t('workspaces.emptyTitle')}
              action={
                <Button type={'primary'} onClick={openCreate}>
                  {t('workspaces.create')}
                </Button>
              }
            />
          ) : (
            data.items.map((workspace) => (
              <div
                key={workspace.id}
                {...stylex.props(styles.row)}
                role={'button'}
                tabIndex={0}
                onClick={() => setSelected(workspace)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setSelected(workspace);
                }}
              >
                <Flexbox>
                  <Text weight={500}>{workspace.name}</Text>
                  <Text type={'secondary'}>{workspace.slug}</Text>
                </Flexbox>
                <Flexbox horizontal align={'center'} gap={16}>
                  <Text type={'secondary'}>
                    {t('workspaces.members', { count: workspace.memberCount })}
                  </Text>
                  <Text type={'secondary'}>
                    {t('workspaces.devices', { count: workspace.deviceCount })}
                  </Text>
                  <Text type={'secondary'}>{workspace.ownerUsername ?? workspace.ownerEmail}</Text>
                </Flexbox>
              </div>
            ))
          )}

          {!!data && data.total > data.pageSize && (
            <Pagination
              align={'end'}
              current={page}
              pageSize={data.pageSize}
              showSizeChanger={false}
              total={data.total}
              onChange={(nextPage) => setPage(nextPage)}
            />
          )}
        </Flexbox>
      </SettingContainer>

      <MembersDrawer workspace={selected} onClose={() => setSelected(null)} />
    </>
  );
});

Workspaces.displayName = 'AdminWorkspaces';

export default Workspaces;
