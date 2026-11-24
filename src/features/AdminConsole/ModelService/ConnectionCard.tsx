'use client';

import type {
  AdminConsoleAiKeySummary,
  AdminConsoleAiLastTest,
  AdminConsoleConnectionTestResult,
} from '@lobechat/types';
import { Button, Flexbox, Input, Switch, Tag, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import FieldRow from './FieldRow';
import { styles } from './style';
import { formatDateTime } from './utils';

interface ConnectionCardProps {
  apiKey: string;
  baseURL: string;
  enabled: boolean;
  keySummary: AdminConsoleAiKeySummary | null;
  lastTest?: AdminConsoleAiLastTest;
  onApiKeyChange: (value: string) => void;
  onBaseURLChange: (value: string) => void;
  onEnabledChange: (value: boolean) => void;
  onTest: () => void;
  /** A probe is in flight. */
  testing: boolean;
  /** Local result of the latest probe, ahead of the SWR refresh. */
  testResult?: AdminConsoleConnectionTestResult;
}

const ConnectionCard = memo<ConnectionCardProps>(
  ({
    enabled,
    baseURL,
    apiKey,
    keySummary,
    lastTest,
    testResult,
    testing,
    onEnabledChange,
    onBaseURLChange,
    onApiKeyChange,
    onTest,
  }) => {
    const { t } = useTranslation('setting');

    const result = testResult ?? lastTest;
    const canTest = Boolean(baseURL.trim()) && Boolean(keySummary);

    const meta = result
      ? [
          result.latencyMs === undefined ? undefined : `${result.latencyMs}ms`,
          result.modelCount === undefined
            ? undefined
            : t('adminConsole.modelService.connection.modelCount', { count: result.modelCount }),
          formatDateTime(lastTest?.at),
        ]
          .filter(Boolean)
          .join(' · ')
      : '';

    return (
      <div {...sx(styles.card)}>
        <div {...sx(styles.cardHeader)}>
          <div {...sx(styles.cardHeaderText)}>
            <span {...sx(styles.cardTitle)}>{t('adminConsole.modelService.connection.title')}</span>
            <Text fontSize={12} lineHeight={1.6} type={'secondary'}>
              {t('adminConsole.modelService.connection.desc')}
            </Text>
          </div>
          <Tag size={'small'}>{t('adminConsole.modelService.connection.gatewayTag')}</Tag>
        </div>

        <div>
          <FieldRow
            description={t('adminConsole.modelService.connection.enabledDesc')}
            label={t('adminConsole.modelService.connection.enabled')}
          >
            <Switch checked={enabled} onChange={onEnabledChange} />
          </FieldRow>

          <FieldRow
            description={t('adminConsole.modelService.connection.baseURLDesc')}
            label={t('adminConsole.modelService.connection.baseURL')}
          >
            <Input
              placeholder={t('adminConsole.modelService.connection.baseURLPlaceholder')}
              style={{ width: '100%' }}
              value={baseURL}
              onChange={(event) => onBaseURLChange(event.target.value)}
            />
          </FieldRow>

          <FieldRow
            description={t('adminConsole.modelService.connection.apiKeyDesc')}
            label={t('adminConsole.modelService.connection.apiKey')}
          >
            <Flexbox gap={4} width={'100%'}>
              <Input
                autoComplete={'new-password'}
                style={{ width: '100%' }}
                type={'password'}
                value={apiKey}
                placeholder={
                  keySummary
                    ? `••••${keySummary.last4}`
                    : t('adminConsole.modelService.connection.apiKeyPlaceholder')
                }
                onChange={(event) => onApiKeyChange(event.target.value)}
              />
              <span {...sx(styles.keyMeta)}>
                {keySummary
                  ? t('adminConsole.modelService.connection.keyMeta', {
                      last4: keySummary.last4,
                      time: formatDateTime(keySummary.updatedAt),
                    })
                  : t('adminConsole.modelService.connection.keyNotSet')}
              </span>
            </Flexbox>
          </FieldRow>

          <FieldRow
            last
            description={t('adminConsole.modelService.connection.testDesc')}
            label={t('adminConsole.modelService.connection.lastTest')}
          >
            <Flexbox align={'flex-end'} gap={4} style={{ minWidth: 0 }}>
              <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                <Tag color={result ? (result.ok ? 'success' : 'error') : undefined} size={'small'}>
                  {result
                    ? t(
                        result.ok
                          ? 'adminConsole.modelService.connection.testOk'
                          : 'adminConsole.modelService.connection.testFailed',
                      )
                    : t('adminConsole.modelService.connection.neverTested')}
                </Tag>
                <Button disabled={!canTest} loading={testing} size={'small'} onClick={onTest}>
                  {t(
                    testing
                      ? 'adminConsole.modelService.connection.testing'
                      : 'adminConsole.modelService.connection.test',
                  )}
                </Button>
              </Flexbox>
              {meta && <span {...sx(styles.meta)}>{meta}</span>}
              {result && !result.ok && result.errorCode && (
                <span {...sx(styles.meta)}>
                  {t('adminConsole.modelService.connection.errorCode', {
                    code: result.errorCode,
                  })}
                </span>
              )}
              {!canTest && (
                <span {...sx(styles.meta)}>
                  {t('adminConsole.modelService.connection.testNeedsConfig')}
                </span>
              )}
            </Flexbox>
          </FieldRow>
        </div>
      </div>
    );
  },
);

ConnectionCard.displayName = 'AdminModelServiceConnectionCard';

export default ConnectionCard;
