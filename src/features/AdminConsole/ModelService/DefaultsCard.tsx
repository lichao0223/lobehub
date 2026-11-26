'use client';

import type { AdminConsoleAiDefaults, CompanyModel } from '@lobechat/types';
import { Flexbox, Select, Tag, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import FieldRow from './FieldRow';
import { styles } from './style';
import { acceptsDefaultModel, type DefaultModelKey, isDefaultModelCompliant } from './utils';

interface DefaultsCardProps {
  defaults: AdminConsoleAiDefaults;
  models: CompanyModel[];
  onChange: (defaults: AdminConsoleAiDefaults) => void;
}

/**
 * The four defaults, worded and ordered like the personal page's tiers so an
 * administrator and a user describe the same thing with the same name.
 */
const FIELDS: {
  descriptionKey: 'chatDesc' | 'embeddingDesc' | 'titleDesc' | 'verifyDesc';
  key: DefaultModelKey;
  labelKey: 'chat' | 'embedding' | 'title' | 'verify';
}[] = [
  { descriptionKey: 'chatDesc', key: 'chat', labelKey: 'chat' },
  { descriptionKey: 'titleDesc', key: 'title', labelKey: 'title' },
  { descriptionKey: 'verifyDesc', key: 'verify', labelKey: 'verify' },
  { descriptionKey: 'embeddingDesc', key: 'embedding', labelKey: 'embedding' },
];

const DefaultsCard = memo<DefaultsCardProps>(({ defaults, models, onChange }) => {
  const { t } = useTranslation('adminConsole');

  const optionsFor = useMemo(
    () => (key: DefaultModelKey) => {
      const rows = models.filter((model) => acceptsDefaultModel(model, key));
      // A stored value that no longer qualifies stays in the list, marked, so
      // the picker keeps showing what is actually saved and the warning below
      // is attached to something the admin can see.
      const storedId = defaults[key];
      const stale =
        storedId && !isDefaultModelCompliant(models, key, storedId)
          ? models.find((model) => model.id === storedId)
          : undefined;

      return [
        {
          label: t('modelService.defaults.inherit'),
          value: '',
        },
        ...rows.map((model) => ({
          label: `${model.name} · ${model.id}`,
          value: model.id,
        })),
        ...(stale
          ? [
              {
                label: `${stale.name} · ${stale.id} · ${t('modelService.defaults.unsupported')}`,
                value: stale.id,
              },
            ]
          : []),
      ];
    },
    [defaults, models, t],
  );

  const update = (key: DefaultModelKey, value: string) => {
    const next: AdminConsoleAiDefaults = { ...defaults };
    if (value) next[key] = value;
    else delete next[key];
    onChange(next);
  };

  return (
    <div {...sx(styles.card)}>
      <div {...sx(styles.cardHeader)}>
        <div {...sx(styles.cardHeaderText)}>
          <span {...sx(styles.cardTitle)}>{t('modelService.defaults.sectionTitle')}</span>
          <Text fontSize={12} lineHeight={1.6} type={'secondary'}>
            {t('modelService.defaults.desc')}
          </Text>
        </div>
        <Tag size={'small'}>{t('modelService.defaults.optional')}</Tag>
      </div>

      <div>
        {FIELDS.map((row, index) => {
          // Nothing is blocked here, but saving a model that cannot do the job
          // must not pass without the admin seeing why.
          const invalid = !isDefaultModelCompliant(models, row.key, defaults[row.key]);

          return (
            <FieldRow
              description={t(`modelService.defaults.${row.descriptionKey}`)}
              key={row.key}
              label={t(`modelService.defaults.${row.labelKey}`)}
              last={index === FIELDS.length - 1}
            >
              <Flexbox gap={4} style={{ width: '100%' }}>
                <Select
                  allowClear={false}
                  options={optionsFor(row.key)}
                  style={{ width: '100%' }}
                  value={defaults[row.key] ?? ''}
                  onChange={(value) => {
                    // The "inherit" option carries an empty string, but a cleared
                    // select can hand back `undefined`; `String(undefined)` would
                    // persist the literal text "undefined" as a model id.
                    update(row.key, typeof value === 'string' ? value : '');
                  }}
                />
                {invalid && (
                  <Text fontSize={12} lineHeight={1.6} type={'warning'}>
                    {t(
                      row.key === 'verify'
                        ? 'modelService.defaults.verifyInvalid'
                        : 'modelService.defaults.invalid',
                    )}
                  </Text>
                )}
              </Flexbox>
            </FieldRow>
          );
        })}
      </div>
    </div>
  );
});

DefaultsCard.displayName = 'AdminModelServiceDefaultsCard';

export default DefaultsCard;
