'use client';

import type { CompanyModel, CompanyModelCapability } from '@lobechat/types';
import { COMPANY_MODEL_CAPABILITIES } from '@lobechat/types';
import {
  Button,
  CheckboxGroup,
  confirmModal,
  createModal,
  Flexbox,
  Input,
  InputNumber,
  ModalFooter,
  Select,
  Switch,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import type { AiModelType } from 'model-bank';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { capabilityLabelKey, MODEL_TYPES, modelTypeLabelKey } from './utils';

interface ModelFormOptions {
  /** Ids already in the catalog, used to reject a duplicate manual add. */
  existingIds: string[];
  /** `undefined` opens the dialog in add mode. */
  model?: CompanyModel;
  onRemove?: (model: CompanyModel) => void;
  /** Resolves true when the write landed, so the dialog can close. */
  onSave: (model: CompanyModel) => Promise<boolean>;
}

const ModelForm = ({ model, existingIds, onSave, onRemove }: ModelFormOptions) => {
  const { t } = useTranslation('adminConsole');
  const { close } = useModalContext();
  const isEdit = Boolean(model);

  const [name, setName] = useState(model?.name ?? '');
  const [id, setId] = useState(model?.id ?? '');
  const [type, setType] = useState<AiModelType>(model?.type ?? 'chat');
  const [contextWindowTokens, setContextWindowTokens] = useState<number | null>(
    model?.contextWindowTokens ?? null,
  );
  const [capabilities, setCapabilities] = useState<string[]>(model?.capabilities ?? []);
  const [open, setOpen] = useState(model?.open ?? false);
  const [saving, setSaving] = useState(false);

  const duplicate = !isEdit && existingIds.includes(id.trim());
  const invalid = !id.trim() || !name.trim() || duplicate;

  const save = async () => {
    if (invalid) {
      if (duplicate) toast.error(t('modelService.edit.duplicateId'));
      return;
    }

    setSaving(true);
    const next: CompanyModel = {
      ...(capabilities.length ? { capabilities: capabilities as CompanyModelCapability[] } : {}),
      ...(contextWindowTokens && contextWindowTokens > 0 ? { contextWindowTokens } : {}),
      id: id.trim(),
      name: name.trim(),
      open,
      // The admin has reviewed the row: the pending marker is cleared.
      ...(model?.removedAt ? { removedAt: model.removedAt } : {}),
      source: model?.source ?? 'manual',
      type,
    };

    try {
      if (await onSave(next)) close();
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!model || !onRemove) return;

    confirmModal({
      okText: t('modelService.edit.removeConfirm'),
      title: t('modelService.edit.removeTitle'),
      content: t('modelService.edit.removeContent', { name: model.name }),
      cancelText: t('modelService.action.close'),
      onOk: () => {
        onRemove(model);
        close();
      },
    });
  };

  return (
    <>
      <Flexbox gap={16} paddingBlock={8}>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('modelService.edit.id')}
          </Text>
          <Input
            disabled={isEdit}
            placeholder={t('modelService.edit.idPlaceholder')}
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
          {duplicate && (
            <Text fontSize={12} type={'danger'}>
              {t('modelService.edit.duplicateId')}
            </Text>
          )}
        </Flexbox>

        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('modelService.edit.name')}
          </Text>
          <Input
            placeholder={t('modelService.edit.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Flexbox>

        <Flexbox horizontal gap={12}>
          <Flexbox flex={1} gap={6}>
            <Text fontSize={13} weight={500}>
              {t('modelService.edit.type')}
            </Text>
            <Select
              value={type}
              options={MODEL_TYPES.map((item) => ({
                label: t(modelTypeLabelKey(item)),
                value: item,
              }))}
              onChange={(value) => setType(value as AiModelType)}
            />
          </Flexbox>
          <Flexbox flex={1} gap={6}>
            <Text fontSize={13} weight={500}>
              {t('modelService.edit.context')}
            </Text>
            <InputNumber
              controls={false}
              min={0}
              placeholder={t('modelService.edit.contextPlaceholder')}
              style={{ width: '100%' }}
              value={contextWindowTokens}
              onChange={(value) => setContextWindowTokens(value)}
            />
          </Flexbox>
        </Flexbox>

        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('modelService.edit.capabilities')}
          </Text>
          <CheckboxGroup
            horizontal
            gap={16}
            value={capabilities}
            options={COMPANY_MODEL_CAPABILITIES.map((capability) => ({
              label: t(capabilityLabelKey(capability)),
              value: capability,
            }))}
            onChange={setCapabilities}
          />
        </Flexbox>

        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Flexbox gap={2}>
            <Text fontSize={13} weight={500}>
              {t('modelService.edit.open')}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t('modelService.edit.openDesc')}
            </Text>
          </Flexbox>
          <Switch checked={open} onChange={setOpen} />
        </Flexbox>
      </Flexbox>

      <ModalFooter>
        {isEdit && onRemove && (
          <Button danger type={'text'} onClick={remove}>
            {t('modelService.edit.remove')}
          </Button>
        )}
        <Button type={'fill'} onClick={close}>
          {t('modelService.action.close')}
        </Button>
        <Button
          disabled={invalid}
          loading={saving}
          type={'primary'}
          onClick={() => {
            void save();
          }}
        >
          {t('modelService.edit.save')}
        </Button>
      </ModalFooter>
    </>
  );
};

interface OpenModelFormOptions extends ModelFormOptions {
  title: ReactNode;
}

export const openModelFormModal = ({ title, ...options }: OpenModelFormOptions) =>
  createModal({
    content: <ModelForm {...options} />,
    footer: null,
    title,
    width: 520,
  });
