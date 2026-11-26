'use client';

import type {
  AdminConsoleCatalogDiff,
  AdminConsoleCatalogSyncResult,
  CompanyModel,
} from '@lobechat/types';
import { ADMIN_CONSOLE_ERROR } from '@lobechat/types';
import {
  Button,
  Center,
  createModal,
  Flexbox,
  ModalFooter,
  Spin,
  Tag,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { adminConsoleService } from '@/services/adminConsole';
import { sx } from '@/styles/sx';

import { styles } from './style';
import { errorCodeOf, formatContext, modelTypeLabelKey } from './utils';

interface SyncDiffContentProps {
  expectedUpdatedAt?: string;
  onApplied: (result: AdminConsoleCatalogSyncResult) => void;
}

const DiffRow = ({ model }: { model: CompanyModel }) => {
  const { t } = useTranslation('adminConsole');

  return (
    <div {...sx(styles.diffRow)}>
      <Flexbox gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis>{model.name}</Text>
        <span {...sx(styles.monospace, styles.meta)}>{model.id}</span>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={4}>
        <Tag size={'small'}>{t(modelTypeLabelKey(model.type))}</Tag>
        {model.contextWindowTokens !== undefined && (
          <span {...sx(styles.meta)}>{formatContext(model.contextWindowTokens)}</span>
        )}
        {model.pending && (
          <Tag color={'warning'} size={'small'}>
            {t('modelService.catalog.pending')}
          </Tag>
        )}
        {model.removedAt && (
          <Tag color={'error'} size={'small'}>
            {t('modelService.catalog.removed')}
          </Tag>
        )}
      </Flexbox>
    </div>
  );
};

const DiffGroup = ({ models, title }: { models: CompanyModel[]; title: string }) =>
  models.length === 0 ? null : (
    <div {...sx(styles.diffGroup)}>
      <span {...sx(styles.diffGroupTitle)}>
        {title} · {models.length}
      </span>
      <div {...sx(styles.diffList)}>
        {models.map((model) => (
          <DiffRow key={model.id} model={model} />
        ))}
      </div>
    </div>
  );

const CountTags = ({ diff }: { diff: AdminConsoleCatalogDiff }) => {
  const { t } = useTranslation('adminConsole');

  const entries: Array<{ key: keyof AdminConsoleCatalogDiff; label: string; tone?: string }> = [
    { key: 'added', label: t('modelService.sync.added'), tone: 'success' },
    { key: 'removed', label: t('modelService.sync.removed'), tone: 'error' },
    { key: 'restored', label: t('modelService.sync.restored') },
    { key: 'updated', label: t('modelService.sync.updated') },
    { key: 'unchanged', label: t('modelService.sync.unchanged') },
  ];

  return (
    <Flexbox horizontal gap={4} wrap={'wrap'}>
      {entries.map((entry) => (
        <Tag color={entry.tone} key={entry.key} size={'small'}>
          {entry.label} · {diff[entry.key].length}
        </Tag>
      ))}
    </Flexbox>
  );
};

const SyncDiffContent = ({ expectedUpdatedAt, onApplied }: SyncDiffContentProps) => {
  const { t } = useTranslation('adminConsole');
  const { close } = useModalContext();
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string>();

  // Dry run: `apply: false` never writes, so previewing is safe to cache by version.
  const { data, error, isLoading, mutate } = useClientDataSWR<AdminConsoleCatalogSyncResult>(
    ['admin-console-model-catalog-diff', expectedUpdatedAt ?? null],
    () => adminConsoleService.refreshModelCatalog({ apply: false, expectedUpdatedAt }),
  );

  const errorCode = applyError ?? errorCodeOf(error);

  const apply = async () => {
    setApplying(true);
    try {
      const result = await adminConsoleService.refreshModelCatalog({
        apply: true,
        expectedUpdatedAt,
      });
      toast.success(
        t('modelService.sync.applied', {
          added: result.diff.added.length,
          removed: result.diff.removed.length,
        }),
      );
      onApplied(result);
      close();
    } catch (cause) {
      setApplyError(errorCodeOf(cause));
    } finally {
      setApplying(false);
    }
  };

  const retry = () => {
    setApplyError(undefined);
    void mutate();
  };

  if (isLoading && !data && !errorCode) {
    return (
      <Center height={200}>
        <Spin />
      </Center>
    );
  }

  if (errorCode) {
    const needsConfig = errorCode === ADMIN_CONSOLE_ERROR.providerNotConfigured;
    return (
      <>
        <Flexbox gap={12} paddingBlock={8}>
          <Text>
            {needsConfig
              ? t('modelService.sync.needsConfig')
              : t('modelService.sync.failed', { code: errorCode })}
          </Text>
        </Flexbox>
        <ModalFooter>
          <Button type={'fill'} onClick={close}>
            {t('modelService.action.close')}
          </Button>
          <Button type={'text'} onClick={retry}>
            {t('modelService.action.retry')}
          </Button>
        </ModalFooter>
      </>
    );
  }

  const diff = data?.diff;
  if (!diff) return null;

  const changed =
    diff.added.length + diff.removed.length + diff.restored.length + diff.updated.length > 0;

  return (
    <>
      <Flexbox gap={12} paddingBlock={8}>
        <Text fontSize={12} type={'secondary'}>
          {t('modelService.sync.desc', {
            count: data?.upstreamModelCount ?? 0,
          })}
        </Text>
        <CountTags diff={diff} />

        {changed ? (
          <Flexbox gap={4}>
            <DiffGroup models={diff.added} title={t('modelService.sync.added')} />
            <DiffGroup models={diff.restored} title={t('modelService.sync.restored')} />
            <DiffGroup models={diff.removed} title={t('modelService.sync.removed')} />
            <DiffGroup models={diff.updated} title={t('modelService.sync.updated')} />
          </Flexbox>
        ) : (
          <Text type={'secondary'}>{t('modelService.sync.noChanges')}</Text>
        )}

        {diff.needsReview.length > 0 && (
          <Text fontSize={12} type={'secondary'}>
            {t('modelService.sync.needsReview', { count: diff.needsReview.length })}
          </Text>
        )}

        <Text fontSize={12} type={'secondary'}>
          {t('modelService.sync.applyHint')}
        </Text>
      </Flexbox>

      <ModalFooter>
        <Button type={'fill'} onClick={close}>
          {t('modelService.action.close')}
        </Button>
        <Button
          disabled={!changed}
          loading={applying}
          type={'primary'}
          onClick={() => {
            void apply();
          }}
        >
          {t('modelService.sync.apply')}
        </Button>
      </ModalFooter>
    </>
  );
};

interface SyncModalOptions extends SyncDiffContentProps {
  title: ReactNode;
}

export const openCatalogSyncModal = ({ title, ...props }: SyncModalOptions) =>
  createModal({
    content: <SyncDiffContent {...props} />,
    footer: null,
    title,
    width: 640,
  });
