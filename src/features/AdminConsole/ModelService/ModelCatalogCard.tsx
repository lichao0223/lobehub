'use client';

import type { CompanyModel } from '@lobechat/types';
import { Button, Empty, Flexbox, SearchBar, Switch, Tag, Text } from '@lobehub/ui';
import type { AiModelType } from 'model-bank';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { MODEL_LIST_COLUMNS, styles } from './style';
import { capabilityLabelKey, formatContext, MODEL_TYPES, modelTypeLabelKey } from './utils';

interface ModelCatalogCardProps {
  models: CompanyModel[];
  onAdd: () => void;
  onEdit: (model: CompanyModel) => void;
  onSync: () => void;
  onToggleOpen: (model: CompanyModel, open: boolean) => void;
  /** Row whose open switch is being persisted. */
  pendingModelId?: string | null;
}

type TypeFilter = 'all' | AiModelType;

const ModelCatalogCard = ({
  models,
  pendingModelId,
  onAdd,
  onEdit,
  onSync,
  onToggleOpen,
}: ModelCatalogCardProps) => {
  const { t } = useTranslation('adminConsole');
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const openCount = models.filter((model) => model.open).length;

  const counts = useMemo(() => {
    const next = new Map<AiModelType, number>();
    for (const type of MODEL_TYPES) next.set(type, 0);
    for (const model of models) next.set(model.type, (next.get(model.type) ?? 0) + 1);
    return next;
  }, [models]);

  const rows = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return models.filter((model) => {
      const hitType = typeFilter === 'all' || model.type === typeFilter;
      const hitKeyword = !query || `${model.id} ${model.name}`.toLowerCase().includes(query);
      return hitType && hitKeyword;
    });
  }, [keyword, models, typeFilter]);

  const resetFilters = () => {
    setKeyword('');
    setTypeFilter('all');
  };

  return (
    <div {...sx(styles.card)}>
      <div {...sx(styles.cardHeader)}>
        <div {...sx(styles.cardHeaderText)}>
          <span {...sx(styles.cardTitle)}>{t('modelService.catalog.title')}</span>
          <Text fontSize={12} lineHeight={1.6} type={'secondary'}>
            {t('modelService.catalog.desc', {
              count: models.length,
              open: openCount,
            })}
          </Text>
        </div>
        <Flexbox horizontal align={'center'} gap={8}>
          <Button size={'small'} type={'text'} onClick={onSync}>
            {t('modelService.catalog.sync')}
          </Button>
          <Button size={'small'} onClick={onAdd}>
            {t('modelService.catalog.add')}
          </Button>
        </Flexbox>
      </div>

      <div {...sx(styles.toolbar)}>
        <SearchBar
          allowClear
          placeholder={t('modelService.catalog.searchPlaceholder')}
          style={{ maxWidth: 320, minWidth: 220 }}
          value={keyword}
          variant={'filled'}
          onInputChange={setKeyword}
        />
        <div {...sx(styles.chips)}>
          <Button
            size={'small'}
            type={typeFilter === 'all' ? 'primary' : 'text'}
            onClick={() => setTypeFilter('all')}
          >
            {t('modelService.catalog.allTypes')}
            <span {...sx(styles.meta)}> {models.length}</span>
          </Button>
          {MODEL_TYPES.map((type) => (
            <Button
              disabled={counts.get(type) === 0}
              key={type}
              size={'small'}
              type={typeFilter === type ? 'primary' : 'text'}
              onClick={() => setTypeFilter(type)}
            >
              {t(modelTypeLabelKey(type))}
              <span {...sx(styles.meta)}> {counts.get(type) ?? 0}</span>
            </Button>
          ))}
        </div>
      </div>

      <div>
        <div {...sx(styles.headerRow, { gridTemplateColumns: MODEL_LIST_COLUMNS })}>
          <span>{t('modelService.catalog.column.model')}</span>
          <span>{t('modelService.catalog.column.type')}</span>
          <span>{t('modelService.catalog.column.context')}</span>
          <span>{t('modelService.catalog.column.open')}</span>
          <span />
        </div>

        {rows.length === 0 ? (
          <div {...sx(styles.empty)}>
            <Empty
              description={t(
                models.length === 0
                  ? 'modelService.catalog.empty'
                  : 'modelService.catalog.emptyFiltered',
              )}
            />
            {(keyword || typeFilter !== 'all') && (
              <Button size={'small'} type={'text'} onClick={resetFilters}>
                {t('modelService.catalog.clear')}
              </Button>
            )}
          </div>
        ) : (
          rows.map((model) => (
            <div key={model.id} {...sx(styles.row, { gridTemplateColumns: MODEL_LIST_COLUMNS })}>
              <div {...sx(styles.modelCell)}>
                <div {...sx(styles.modelName)}>
                  <Text ellipsis style={{ minWidth: 0 }}>
                    {model.name}
                  </Text>
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
                </div>
                <span {...sx(styles.monospace, styles.meta)}>{model.id}</span>
              </div>

              <div {...sx(styles.chips)}>
                <Tag size={'small'}>{t(modelTypeLabelKey(model.type))}</Tag>
                {(model.capabilities ?? []).map((capability) => (
                  <Tag key={capability} size={'small'}>
                    {t(capabilityLabelKey(capability))}
                  </Tag>
                ))}
              </div>

              <span {...sx(styles.monospace)}>{formatContext(model.contextWindowTokens)}</span>

              <Switch
                checked={model.open}
                loading={pendingModelId === model.id}
                size={'small'}
                onChange={(checked) => onToggleOpen(model, checked)}
              />

              <Button size={'small'} type={'text'} onClick={() => onEdit(model)}>
                {t('modelService.catalog.edit')}
              </Button>
            </div>
          ))
        )}
      </div>

      <span {...sx(styles.footerHint)}>{t('modelService.catalog.hint')}</span>
    </div>
  );
};

export default ModelCatalogCard;
