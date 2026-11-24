'use client';

import type { AdminConsoleAiDefaults, CompanyModel } from '@lobechat/types';
import { Select, Tag, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import FieldRow from './FieldRow';
import { styles } from './style';

interface DefaultsCardProps {
  defaults: AdminConsoleAiDefaults;
  models: CompanyModel[];
  onChange: (defaults: AdminConsoleAiDefaults) => void;
}

type DefaultKey = 'chat' | 'embedding' | 'title' | 'verify';

const PURPOSE_TYPES: Record<DefaultKey, Array<CompanyModel['type']>> = {
  chat: ['chat'],
  embedding: ['embedding'],
  title: ['chat'],
  verify: ['chat'],
};

const DefaultsCard = memo<DefaultsCardProps>(({ defaults, models, onChange }) => {
  const { t } = useTranslation('setting');

  const optionsFor = useMemo(
    () => (key: DefaultKey) => {
      const accepted = PURPOSE_TYPES[key];
      const rows = models.filter(
        (model) => accepted.includes(model.type) && (key === 'chat' ? model.open : true),
      );

      return [
        {
          label: t('adminConsole.modelService.defaults.inherit'),
          value: '',
        },
        ...rows.map((model) => ({
          label: `${model.name} · ${model.id}`,
          value: model.id,
        })),
      ];
    },
    [models, t],
  );

  const update = (key: DefaultKey, value: string) => {
    const next: AdminConsoleAiDefaults = { ...defaults };
    if (value) next[key] = value;
    else delete next[key];
    onChange(next);
  };

  const rows = [
    {
      descriptionKey: 'adminConsole.modelService.defaults.chatDesc',
      key: 'chat',
      labelKey: 'adminConsole.modelService.defaults.chat',
    },
    {
      descriptionKey: 'adminConsole.modelService.defaults.embeddingDesc',
      key: 'embedding',
      labelKey: 'adminConsole.modelService.defaults.embedding',
    },
    {
      descriptionKey: 'adminConsole.modelService.defaults.titleDesc',
      key: 'title',
      labelKey: 'adminConsole.modelService.defaults.title',
    },
    {
      descriptionKey: 'adminConsole.modelService.defaults.verifyDesc',
      key: 'verify',
      labelKey: 'adminConsole.modelService.defaults.verify',
    },
  ] as const;

  return (
    <div {...sx(styles.card)}>
      <div {...sx(styles.cardHeader)}>
        <div {...sx(styles.cardHeaderText)}>
          <span {...sx(styles.cardTitle)}>
            {t('adminConsole.modelService.defaults.sectionTitle')}
          </span>
          <Text fontSize={12} lineHeight={1.6} type={'secondary'}>
            {t('adminConsole.modelService.defaults.desc')}
          </Text>
        </div>
        <Tag size={'small'}>{t('adminConsole.modelService.defaults.optional')}</Tag>
      </div>

      <div>
        {rows.map((row, index) => (
          <FieldRow
            description={t(row.descriptionKey)}
            key={row.key}
            label={t(row.labelKey)}
            last={index === rows.length - 1}
          >
            <Select
              allowClear={false}
              options={optionsFor(row.key)}
              style={{ width: '100%' }}
              value={defaults[row.key] ?? ''}
              onChange={(value) => update(row.key, String(value))}
            />
          </FieldRow>
        ))}
      </div>
    </div>
  );
});

DefaultsCard.displayName = 'AdminModelServiceDefaultsCard';

export default DefaultsCard;
