'use client';

import { Text } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';

import { sx } from '@/styles/sx';

import { styles } from './style';
import { fieldRowClass } from './utils';

interface FieldRowProps {
  children: ReactNode;
  description?: ReactNode;
  label: ReactNode;
  last?: boolean;
}

/**
 * One label / control pair inside a card. The grid column keeps every card's
 * controls aligned even when the descriptions differ in length.
 */
const FieldRow = memo<FieldRowProps>(({ label, description, children, last }) => (
  <div {...fieldRowClass(last)}>
    <div {...sx(styles.fieldLabel)}>
      <span {...sx(styles.fieldLabelTitle)}>{label}</span>
      {description && (
        <Text fontSize={12} lineHeight={1.6} type={'secondary'}>
          {description}
        </Text>
      )}
    </div>
    <div {...sx(styles.fieldControl)}>{children}</div>
  </div>
));

FieldRow.displayName = 'AdminModelServiceFieldRow';

export default FieldRow;
