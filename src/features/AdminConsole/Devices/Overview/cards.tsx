'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';
import { sx } from '@/styles/sx';

import type { UsageThresholds } from './format';
import { formatPercent, usageLevel } from './format';
import { UsageBar, usageTextColor } from './usage';

/**
 * Card shell shared by every block on the console overview: a tinted header
 * carries the title, the body holds either padded content or self-padded rows.
 */
const styles = stylex.create({
  body: {
    padding: 16,
  },
  card: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    columnGap: 8,
    display: 'flex',
    justifyContent: 'space-between',
    paddingBlock: 10,
    paddingInline: 16,
  },
  headerTitle: {
    alignItems: 'center',
    columnGap: 8,
    display: 'flex',
  },
  row: {
    alignItems: 'center',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: {
      'default': 1,
      ':first-child': 0,
    },
    columnGap: 16,
    display: 'flex',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingBlock: 10,
    paddingInline: 16,
  },
  rowLabel: {
    alignItems: 'center',
    columnGap: 8,
    display: 'flex',
    flexShrink: 0,
  },
  rowValue: {
    alignItems: 'center',
    columnGap: 8,
    display: 'flex',
    justifyContent: 'flex-end',
    minWidth: 0,
    textAlign: 'end',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 600,
    lineHeight: 1.2,
  },
});

interface DetailCardProps {
  children: ReactNode;
  extra?: ReactNode;
  icon: LucideIcon;
  /** Rows draw their own padding; free-form content gets the card's. */
  padded?: boolean;
  title: string;
}

export const DetailCard = ({ children, extra, icon, padded = true, title }: DetailCardProps) => (
  <section {...stylex.props(styles.card)}>
    <div {...stylex.props(styles.header)}>
      <div {...stylex.props(styles.headerTitle)}>
        <Icon icon={icon} size={14} style={{ color: cssVar.colorTextTertiary }} />
        <Text fontSize={13} weight={500}>
          {title}
        </Text>
      </div>
      {extra}
    </div>
    {padded ? <div {...stylex.props(styles.body)}>{children}</div> : children}
  </section>
);

export const EmptyValue = () => <Text type={'secondary'}>—</Text>;

interface InfoRowProps {
  children: ReactNode;
  icon: LucideIcon;
  label: string;
}

export const InfoRow = ({ children, icon, label }: InfoRowProps) => (
  <div {...stylex.props(styles.row)}>
    <div {...stylex.props(styles.rowLabel)}>
      <Icon icon={icon} size={14} style={{ color: cssVar.colorTextTertiary }} />
      <Text fontSize={13} type={'secondary'}>
        {label}
      </Text>
    </div>
    <div {...stylex.props(styles.rowValue)}>{children}</div>
  </div>
);

interface StatCardProps {
  detail?: ReactNode;
  icon: LucideIcon;
  /** First read still in flight: placeholders in the reading's own line boxes. */
  loading?: boolean;
  thresholds?: UsageThresholds;
  title: string;
  value: number | null | undefined;
}

/** One reading at a glance: the big share, its absolute size, and the segmented bar. */
export const StatCard = ({ detail, icon, loading, thresholds, title, value }: StatCardProps) => (
  <DetailCard icon={icon} title={title}>
    {loading ? (
      <Flexbox aria-busy gap={14}>
        <Flexbox justify={'center'} style={{ height: 34 }}>
          <SkeletonBar height={24} width={72} />
        </Flexbox>
        <SkeletonBar height={8} />
      </Flexbox>
    ) : (
      <Flexbox gap={14}>
        <Flexbox horizontal align={'baseline'} distribution={'space-between'} gap={8}>
          <span
            {...sx(styles.statValue, {
              color: usageTextColor(usageLevel(value, thresholds)),
            })}
          >
            {formatPercent(value)}
          </span>
          {detail && (
            <Text ellipsis fontSize={13} type={'secondary'}>
              {detail}
            </Text>
          )}
        </Flexbox>
        <UsageBar thresholds={thresholds} value={value} />
      </Flexbox>
    )}
  </DetailCard>
);
