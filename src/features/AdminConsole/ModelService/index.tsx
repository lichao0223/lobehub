'use client';

import type { AdminConsoleConnectionTestResult, CompanyModel } from '@lobechat/types';
import { ADMIN_CONSOLE_ERROR } from '@lobechat/types';
import { Button, Center, confirmModal, Empty, Flexbox, Spin, Text, toast } from '@lobehub/ui';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { adminConsoleService } from '@/services/adminConsole';
import { useDensityTokens } from '@/styles/density';

import { useAdminModelService } from '../hooks/useAdminModelService';
import ConnectionCard from './ConnectionCard';
import DefaultsCard from './DefaultsCard';
import ModelCatalogCard from './ModelCatalogCard';
import { openModelFormModal } from './ModelEditModal';
import { openCatalogSyncModal } from './SyncCatalogModal';
import { errorCodeOf, type ModelServiceForm, toDefaults, toForm } from './utils';

const ModelService = memo(() => {
  const { t } = useTranslation('setting');
  const tokens = useDensityTokens();
  const { data, error, isLoading, mutate } = useAdminModelService();

  const [form, setForm] = useState<ModelServiceForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<AdminConsoleConnectionTestResult | undefined>();

  /**
   * Version of the server row the draft was built from. A refetch that only
   * repeats this version (our own write) must not wipe the admin's draft.
   */
  const draftVersion = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!data) return;
    if (draftVersion.current === data.updatedAt) return;
    draftVersion.current = data.updatedAt;
    setForm(toForm(data.config));
  }, [data]);

  const handleError = useCallback(
    (cause: unknown) => {
      const code = errorCodeOf(cause);

      switch (code) {
        case ADMIN_CONSOLE_ERROR.configConflict: {
          confirmModal({
            cancelText: t('adminConsole.modelService.action.close'),
            content: t('adminConsole.modelService.error.conflictContent'),
            okText: t('adminConsole.modelService.error.conflictRefresh'),
            title: t('adminConsole.modelService.error.conflictTitle'),
            onOk: async () => {
              draftVersion.current = null;
              await mutate();
            },
          });
          break;
        }
        case ADMIN_CONSOLE_ERROR.providerNotConfigured: {
          toast.error(t('adminConsole.modelService.error.notConfigured'));
          break;
        }
        case ADMIN_CONSOLE_ERROR.invalidBaseUrl: {
          toast.error(t('adminConsole.modelService.error.invalidBaseUrl'));
          break;
        }
        case ADMIN_CONSOLE_ERROR.invalidApiKey: {
          toast.error(t('adminConsole.modelService.error.invalidApiKey'));
          break;
        }
        case ADMIN_CONSOLE_ERROR.invalidDefaultModel: {
          toast.error(t('adminConsole.modelService.error.invalidDefaultModel'));
          break;
        }
        case ADMIN_CONSOLE_ERROR.duplicateModelId: {
          toast.error(t('adminConsole.modelService.error.duplicateModelId'));
          break;
        }
        case ADMIN_CONSOLE_ERROR.invalidModel:
        case ADMIN_CONSOLE_ERROR.invalidModelType: {
          toast.error(t('adminConsole.modelService.error.invalidModel'));
          break;
        }
        default: {
          toast.error(
            code
              ? t('adminConsole.modelService.error.withCode', { code })
              : t('adminConsole.modelService.error.generic'),
          );
        }
      }
    },
    [mutate, t],
  );

  /** Write the catalog only; unsaved connection edits stay in the draft. */
  const persistModels = useCallback(
    async (models: CompanyModel[], message?: string) => {
      if (!form) return false;

      try {
        const result = await adminConsoleService.updateModelServiceConfig({
          enabled: form.enabled,
          expectedUpdatedAt: data?.updatedAt ?? undefined,
          models,
        });
        draftVersion.current = result.updatedAt;
        setForm((prev) =>
          prev ? { ...prev, models: result.config.models } : toForm(result.config),
        );
        if (message) toast.success(message);
        void mutate();
        return true;
      } catch (cause) {
        handleError(cause);
        return false;
      }
    },
    [data, form, handleError, mutate],
  );

  const save = async () => {
    if (!form) return;

    setSaving(true);
    try {
      const result = await adminConsoleService.updateModelServiceConfig({
        apiKey: form.apiKey.trim() || undefined,
        baseURL: form.baseURL,
        defaults: toDefaults(form.defaults),
        enabled: form.enabled,
        expectedUpdatedAt: data?.updatedAt ?? undefined,
        models: form.models,
      });
      draftVersion.current = result.updatedAt;
      setForm(toForm(result.config));
      setTestResult(undefined);
      toast.success(t('adminConsole.modelService.action.saved'));
      void mutate();
    } catch (cause) {
      handleError(cause);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const result = await adminConsoleService.testModelServiceConnection();
      setTestResult(result);
      if (result.ok) {
        toast.success(
          t('adminConsole.modelService.connection.testSuccess', {
            count: result.modelCount ?? 0,
            latency: result.latencyMs ?? 0,
          }),
        );
      } else {
        toast.error(
          t('adminConsole.modelService.connection.testFailure', {
            code: result.errorCode ?? '—',
          }),
        );
      }
      await mutate();
    } catch (cause) {
      handleError(cause);
    } finally {
      setTesting(false);
    }
  };

  const toggleOpen = (model: CompanyModel, open: boolean) => {
    if (!form) return;

    const next = form.models.map((item) => (item.id === model.id ? { ...item, open } : item));
    setPendingModelId(model.id);
    void persistModels(
      next,
      t(
        open
          ? 'adminConsole.modelService.catalog.opened'
          : 'adminConsole.modelService.catalog.closed',
        { name: model.name },
      ),
    ).finally(() => setPendingModelId(null));
  };

  const openAdd = () => {
    if (!form) return;

    openModelFormModal({
      existingIds: form.models.map((model) => model.id),
      onSave: (model) =>
        persistModels([...form.models, model], t('adminConsole.modelService.edit.added')),
      title: t('adminConsole.modelService.edit.titleAdd'),
    });
  };

  const openEdit = (model: CompanyModel) => {
    if (!form) return;

    openModelFormModal({
      existingIds: form.models.map((item) => item.id),
      model,
      onRemove: (removed) => {
        void persistModels(
          form.models.filter((item) => item.id !== removed.id),
          t('adminConsole.modelService.edit.removed', { name: removed.name }),
        );
      },
      onSave: (next) =>
        persistModels(
          form.models.map((item) => (item.id === next.id ? next : item)),
          t('adminConsole.modelService.edit.saved'),
        ),
      title: t('adminConsole.modelService.edit.titleEdit'),
    });
  };

  const openSync = () => {
    openCatalogSyncModal({
      expectedUpdatedAt: data?.updatedAt ?? undefined,
      title: t('adminConsole.modelService.sync.title'),
      onApplied: async () => {
        draftVersion.current = null;
        await mutate();
      },
    });
  };

  const resetDraft = () => {
    if (!data) return;
    setForm(toForm(data.config));
    toast.success(t('adminConsole.modelService.action.reset'));
  };

  return (
    <>
      <NavHeader
        right={
          form ? (
            <Flexbox horizontal align={'center'} gap={8}>
              <Button size={'small'} type={'text'} onClick={resetDraft}>
                {t('adminConsole.modelService.action.resetButton')}
              </Button>
              <Button
                loading={saving}
                size={'small'}
                type={'primary'}
                onClick={() => {
                  void save();
                }}
              >
                {t('adminConsole.modelService.action.save')}
              </Button>
            </Flexbox>
          ) : null
        }
      >
        <Text weight={500}>{t('adminConsole.modelService.title')}</Text>
      </NavHeader>

      <SettingContainer
        maxWidth={1024}
        paddingBlock={`${tokens.pagePaddingBlockStart}px 128px`}
        paddingInline={tokens.pagePaddingInline}
      >
        {isLoading && !form ? (
          <Center height={320}>
            <Spin />
          </Center>
        ) : error && !form ? (
          <Empty
            description={t('adminConsole.modelService.error.generic')}
            title={t('adminConsole.modelService.error.loadFailed')}
            action={
              <Button
                onClick={() => {
                  void mutate();
                }}
              >
                {t('adminConsole.modelService.action.retry')}
              </Button>
            }
          />
        ) : form ? (
          <Flexbox gap={tokens.sectionGap}>
            <Flexbox gap={4}>
              <Text fontSize={12} lineHeight={1.6} type={'secondary'}>
                {t('adminConsole.modelService.subtitle')}
              </Text>
              <Text fontSize={12} lineHeight={1.6} type={'secondary'}>
                {t('adminConsole.modelService.note')}
              </Text>
            </Flexbox>

            <ConnectionCard
              apiKey={form.apiKey}
              baseURL={form.baseURL}
              enabled={form.enabled}
              keySummary={data?.config.apiKey ?? null}
              lastTest={data?.config.lastTest}
              testResult={testResult}
              testing={testing}
              onApiKeyChange={(apiKey) => setForm((prev) => (prev ? { ...prev, apiKey } : prev))}
              onBaseURLChange={(baseURL) => setForm((prev) => (prev ? { ...prev, baseURL } : prev))}
              onEnabledChange={(enabled) => setForm((prev) => (prev ? { ...prev, enabled } : prev))}
              onTest={() => {
                void runTest();
              }}
            />

            <ModelCatalogCard
              models={form.models}
              pendingModelId={pendingModelId}
              onAdd={openAdd}
              onEdit={openEdit}
              onSync={openSync}
              onToggleOpen={toggleOpen}
            />

            <DefaultsCard
              defaults={form.defaults}
              models={form.models}
              onChange={(defaults) => setForm((prev) => (prev ? { ...prev, defaults } : prev))}
            />

            <Text fontSize={12} type={'secondary'}>
              {t('adminConsole.modelService.footer')}
            </Text>
          </Flexbox>
        ) : null}
      </SettingContainer>
    </>
  );
});

ModelService.displayName = 'AdminModelService';

export default ModelService;
