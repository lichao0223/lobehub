'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import type { AdminConsoleLabsMode } from '@lobechat/types';
import { ADMIN_CONSOLE_ERROR } from '@lobechat/types';
import {
  Alert,
  Button,
  Center,
  confirmModal,
  Empty,
  Flexbox,
  Segmented,
  Spin,
  Switch,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import dayjs from 'dayjs';
import { FlaskConicalIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { adminConsoleService } from '@/services/adminConsole';
import { useDensityTokens } from '@/styles/density';
import { sx } from '@/styles/sx';

import { useAdminLabs } from '../hooks/useAdminLabs';
import { errorCodeOf } from '../ModelService/utils';
import { defaultFlagValue, flagsFingerprint, toSparseFlags } from './draft';
import {
  getLabExtraSwitches,
  getLabMatrixRows,
  getLabRowAvailability,
  getLabRowBadges,
  isSelectorOnlyRow,
  LAB_EXTRA_COPY_STEM,
  LAB_FLAG_READ_ONLY,
  type LabMatrixRow,
} from './matrix';
import { LAB_MATRIX_COLUMNS, styles } from './style';

interface LabRowProps {
  last: boolean;
  onToggle: (flag: string, value: boolean) => void;
  readOnly: boolean;
  row: LabMatrixRow;
  switchDisabled: boolean;
  unavailable: boolean;
  value: boolean;
}

const LabRow = memo<LabRowProps>(
  ({ last, onToggle, readOnly, row, switchDisabled, unavailable, value }) => {
    const { flag } = row;
    const feature = row.kind === 'feature' ? row.feature : undefined;
    const { t } = useTranslation('setting');
    const { t: tLabs } = useTranslation('labs');

    // Selector-only rows with upstream copy (`enableTaskVerify`); every other
    // one falls back to its raw flag.
    const copyStem = feature ? undefined : LAB_EXTRA_COPY_STEM[flag];
    const title = feature
      ? tLabs(`features.${feature.i18nKey}.title`)
      : copyStem
        ? tLabs(`features.${copyStem}.title`)
        : flag;
    const desc = feature
      ? tLabs(`features.${feature.i18nKey}.desc`)
      : copyStem
        ? tLabs(`features.${copyStem}.desc`)
        : '';

    return (
      <div {...sx(styles.row, { gridTemplateColumns: LAB_MATRIX_COLUMNS }, last && styles.rowLast)}>
        <div {...sx(styles.flagCell)}>
          <div {...sx(styles.flagTitle)}>
            <Text weight={500}>{title}</Text>
            {feature ? (
              <Tag color={feature.stage === 'alpha' ? 'warning' : 'info'} size={'small'}>
                {tLabs(`stage.${feature.stage}.label`)}
              </Tag>
            ) : null}
            {readOnly ? (
              <Tag color={'warning'} size={'small'}>
                {t('adminConsole.labs.badge.readOnly')}
              </Tag>
            ) : null}
            {unavailable ? (
              <Tag color={'error'} size={'small'}>
                {t('adminConsole.labs.badge.unavailable')}
              </Tag>
            ) : null}
          </div>
          {desc ? <span {...sx(styles.flagDesc)}>{desc}</span> : null}
          {isSelectorOnlyRow(row) ? (
            <span {...sx(styles.flagDesc)}>{t('adminConsole.labs.note.noSettingsEntry')}</span>
          ) : null}
          {feature?.noteI18nKey ? (
            <span {...sx(styles.flagDesc)}>{tLabs(`features.${feature.noteI18nKey}.note`)}</span>
          ) : null}
          {readOnly && LAB_FLAG_READ_ONLY[flag] === 'pageCollabDeployment' ? (
            <span {...sx(styles.flagDesc)}>{t('adminConsole.labs.note.pageCollabDeployment')}</span>
          ) : null}
          {unavailable ? (
            <span {...sx(styles.flagDesc)}>{t('adminConsole.labs.note.businessUnavailable')}</span>
          ) : null}
          <span {...sx(styles.flagCode)}>{flag}</span>
        </div>

        <div {...sx(styles.badges)}>
          {getLabRowBadges(row).map((badge) => (
            <Tag key={badge} size={'small'}>
              {t(`adminConsole.labs.badge.${badge}`)}
            </Tag>
          ))}
        </div>

        <Switch
          checked={value}
          disabled={switchDisabled || readOnly || unavailable}
          size={'small'}
          onChange={(next) => onToggle(flag, next)}
        />
      </div>
    );
  },
);

LabRow.displayName = 'AdminLabRow';

const LAB_MODE_OPTION = [
  { labelKey: 'adminConsole.labs.mode.user', value: 'user' },
  { labelKey: 'adminConsole.labs.mode.admin', value: 'admin' },
] as const;

const Labs = memo(() => {
  const { t } = useTranslation('setting');
  const tokens = useDensityTokens();
  const { data, error, isLoading, mutate } = useAdminLabs();
  const rows = useMemo(() => getLabMatrixRows(), []);
  const extras = useMemo(() => getLabExtraSwitches(), []);

  const [mode, setMode] = useState<AdminConsoleLabsMode>('user');
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  /** Server row version the draft was built from; our own write must not reset it. */
  const draftVersion = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!data) return;
    if (draftVersion.current === data.updatedAt) return;
    draftVersion.current = data.updatedAt;
    setMode(data.mode);
    setFlags({ ...data.flags });
  }, [data]);

  const dirty = data
    ? mode !== data.mode || flagsFingerprint(flags) !== flagsFingerprint(data.flags)
    : false;
  const switchDisabled = mode !== 'admin' || saving;

  const handleError = (cause: unknown) => {
    const code = errorCodeOf(cause);

    if (code === ADMIN_CONSOLE_ERROR.configConflict) {
      confirmModal({
        cancelText: t('adminConsole.labs.error.conflictDismiss'),
        content: t('adminConsole.labs.error.conflictContent'),
        okText: t('adminConsole.labs.error.conflictRefresh'),
        title: t('adminConsole.labs.error.conflictTitle'),
        onOk: async () => {
          draftVersion.current = null;
          await mutate();
        },
      });
      return;
    }

    if (code === ADMIN_CONSOLE_ERROR.invalidLabsConfig) {
      toast.error(t('adminConsole.labs.error.invalidLabsConfig'));
      return;
    }

    toast.error(code ?? t('adminConsole.labs.error.generic'));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await adminConsoleService.updateLabsConfig({
        expectedUpdatedAt: data?.updatedAt ?? undefined,
        flags: toSparseFlags(flags),
        mode,
      });
      draftVersion.current = result.updatedAt;
      setMode(result.mode);
      setFlags({ ...result.flags });
      toast.success(t('adminConsole.labs.action.saved'));
      void mutate();
    } catch (cause) {
      handleError(cause);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Mode is a deployment-wide decision, so it is confirmed before the draft
   * changes: the copy spells out who decides in each mode and that saving
   * `admin` immediately applies to every non-administrator.
   */
  const requestModeChange = (next: AdminConsoleLabsMode) => {
    if (next === mode) return;

    const toAdmin = next === 'admin';
    confirmModal({
      cancelText: t('adminConsole.labs.mode.confirmCancel'),
      content: toAdmin
        ? t('adminConsole.labs.mode.confirmToAdminContent')
        : t('adminConsole.labs.mode.confirmToUserContent'),
      okText: t('adminConsole.labs.mode.confirmOk'),
      title: toAdmin
        ? t('adminConsole.labs.mode.confirmToAdminTitle')
        : t('adminConsole.labs.mode.confirmToUserTitle'),
      onOk: () => setMode(next),
    });
  };

  const toggle = (flag: string, value: boolean) =>
    setFlags((previous) => ({ ...previous, [flag]: value }));

  return (
    <>
      <NavHeader>
        <Text weight={500}>{t('adminConsole.labs.title')}</Text>
      </NavHeader>
      <SettingContainer
        maxWidth={1024}
        paddingBlock={`${tokens.pagePaddingBlockStart}px 128px`}
        paddingInline={tokens.pagePaddingInline}
      >
        <Flexbox gap={16}>
          <Alert
            showIcon
            icon={FlaskConicalIcon}
            title={t('adminConsole.labs.desc')}
            type={'info'}
            variant={'filled'}
          />

          {isLoading && !data ? (
            <Center height={240}>
              <Spin />
            </Center>
          ) : error && !data ? (
            <Empty
              description={t('adminConsole.labs.error.loadFailed')}
              title={t('adminConsole.labs.title')}
              action={
                <Button onClick={() => void mutate()}>
                  {t('adminConsole.labs.error.conflictRefresh')}
                </Button>
              }
            />
          ) : (
            <>
              <div {...sx(styles.card)}>
                <div {...sx(styles.cardHeader)}>
                  <div>
                    <div {...sx(styles.cardTitle)}>{t('adminConsole.labs.mode.title')}</div>
                    <div {...sx(styles.cardDesc)}>{t('adminConsole.labs.mode.desc')}</div>
                  </div>
                  <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
                    {data ? (
                      <Text fontSize={12} type={'secondary'}>
                        {t('adminConsole.labs.effectiveMode', {
                          mode: t(
                            `adminConsole.labs.mode.${data.mode === 'admin' ? 'admin' : 'user'}`,
                          ),
                        })}
                      </Text>
                    ) : null}
                    {data?.updatedAt ? (
                      <Text fontSize={12} type={'secondary'}>
                        {t('adminConsole.labs.updatedAt', {
                          time: dayjs(data.updatedAt).format('YYYY-MM-DD HH:mm'),
                        })}
                      </Text>
                    ) : null}
                    {data?.updatedBy ? (
                      <Text fontSize={12} type={'secondary'}>
                        {t('adminConsole.labs.updatedBy', { name: data.updatedBy })}
                      </Text>
                    ) : null}
                    <Button
                      disabled={!dirty}
                      loading={saving}
                      type={'primary'}
                      onClick={() => void save()}
                    >
                      {t('adminConsole.labs.action.save')}
                    </Button>
                  </Flexbox>
                </div>

                <Segmented
                  size={'small'}
                  value={mode}
                  options={LAB_MODE_OPTION.map(({ labelKey, value }) => ({
                    label: t(labelKey),
                    value,
                  }))}
                  onChange={(value) => requestModeChange(value as AdminConsoleLabsMode)}
                />
                <div {...sx(styles.cardDesc)}>
                  {mode === 'admin'
                    ? t('adminConsole.labs.mode.adminDesc')
                    : t('adminConsole.labs.mode.userDesc')}
                </div>
                {!dirty || mode === data?.mode ? null : (
                  <Text fontSize={12} type={'warning'}>
                    {t('adminConsole.labs.note.modePending')}
                  </Text>
                )}
              </div>

              <div {...sx(styles.card)}>
                <div>
                  <div {...sx(styles.cardTitle)}>{t('adminConsole.labs.flags.title')}</div>
                  <div {...sx(styles.cardDesc)}>{t('adminConsole.labs.flags.desc')}</div>
                  <div {...sx(styles.cardDesc)}>{t('adminConsole.labs.note.unsetOff')}</div>
                </div>
                {!switchDisabled ? null : (
                  <Text fontSize={12} type={'secondary'}>
                    {t('adminConsole.labs.note.userMode')}
                  </Text>
                )}

                <div {...sx(styles.headerRow, { gridTemplateColumns: LAB_MATRIX_COLUMNS })}>
                  <span>{t('adminConsole.labs.column.flag')}</span>
                  <span>{t('adminConsole.labs.column.availability')}</span>
                  <span>{t('adminConsole.labs.column.switch')}</span>
                </div>

                {rows.map((row: LabMatrixRow, index) => {
                  const availability = getLabRowAvailability(row, ENABLE_BUSINESS_FEATURES);

                  return (
                    <LabRow
                      key={row.flag}
                      last={index === rows.length - 1}
                      readOnly={availability.readOnly}
                      row={row}
                      switchDisabled={switchDisabled}
                      unavailable={availability.unavailable}
                      value={flags[row.flag] ?? defaultFlagValue(row.flag)}
                      onToggle={toggle}
                    />
                  );
                })}
              </div>

              {extras.length > 0 ? (
                <div {...sx(styles.card)}>
                  <div>
                    <div {...sx(styles.cardTitle)}>{t('adminConsole.labs.extra.title')}</div>
                    <div {...sx(styles.cardDesc)}>{t('adminConsole.labs.extra.desc')}</div>
                  </div>

                  <div {...sx(styles.headerRow, { gridTemplateColumns: LAB_MATRIX_COLUMNS })}>
                    <span>{t('adminConsole.labs.column.flag')}</span>
                    <span>{t('adminConsole.labs.column.availability')}</span>
                    <span>{t('adminConsole.labs.column.switch')}</span>
                  </div>

                  {extras.map((row: LabMatrixRow, index) => {
                    const availability = getLabRowAvailability(row, ENABLE_BUSINESS_FEATURES);

                    return (
                      <LabRow
                        key={row.flag}
                        last={index === extras.length - 1}
                        readOnly={availability.readOnly}
                        row={row}
                        switchDisabled={switchDisabled}
                        unavailable={availability.unavailable}
                        value={flags[row.flag] ?? defaultFlagValue(row.flag)}
                        onToggle={toggle}
                      />
                    );
                  })}
                </div>
              ) : null}
            </>
          )}
        </Flexbox>
      </SettingContainer>
    </>
  );
});

Labs.displayName = 'AdminLabs';

export default Labs;
