import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/** Shared column template: user | account | role | status | last active | chevron. */
export const USER_LIST_COLUMNS = 'minmax(220px, 2.4fr) minmax(110px, 1fr) 96px 96px 144px 20px';

export const styles = stylex.create({
  empty: {
    paddingBlock: 48,
  },
  headerRow: {
    alignItems: 'center',
    borderBottomColor: cssVar.colorBorderSecondary,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    color: cssVar.colorTextTertiary,
    columnGap: 12,
    display: 'grid',
    fontSize: 12,
    fontWeight: 500,
    paddingBlockEnd: 8,
    paddingInline: 12,
  },
  row: {
    alignItems: 'center',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillQuaternary,
    },
    borderBottomColor: cssVar.colorBorderSecondary,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    columnGap: 12,
    cursor: 'pointer',
    display: 'grid',
    outlineColor: cssVar.colorPrimaryBorder,
    outlineStyle: { 'default': 'none', ':focus-visible': 'solid' },
    outlineWidth: { 'default': 0, ':focus-visible': 2 },
    paddingInline: 12,
    transitionDuration: '0.15s',
    transitionProperty: 'background-color',
  },
  secondary: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  userCell: {
    alignItems: 'center',
    columnGap: 10,
    display: 'flex',
    minWidth: 0,
  },
  userText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
});
