import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/**
 * Shared column template:
 * device | owner | scope | presence | platform | last seen | chevron.
 */
export const DEVICE_LIST_COLUMNS =
  'minmax(220px, 2.4fr) minmax(180px, 1.6fr) 96px 96px minmax(120px, 1fr) 144px 20px';

export const styles = stylex.create({
  deviceCell: {
    alignItems: 'center',
    columnGap: 10,
    display: 'flex',
    minWidth: 0,
  },
  deviceIcon: {
    alignItems: 'center',
    color: cssVar.colorTextSecondary,
    display: 'flex',
    flex: 'none',
    justifyContent: 'center',
  },
  deviceText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
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
  ownerCell: {
    alignItems: 'center',
    columnGap: 10,
    display: 'flex',
    minWidth: 0,
  },
  ownerText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  presence: {
    alignItems: 'center',
    columnGap: 6,
    display: 'flex',
    minWidth: 0,
  },
  /** Dot is decorative: the label next to it carries the state in text. */
  presenceDot: {
    borderRadius: '50%',
    flex: 'none',
    height: 8,
    width: 8,
  },
  dotOffline: {
    backgroundColor: cssVar.colorTextQuaternary,
  },
  dotOnline: {
    backgroundColor: cssVar.colorSuccess,
  },
  /** Neutral, NOT the offline grey: "we could not ask" must not read as "gone". */
  dotUnknown: {
    backgroundColor: cssVar.colorTextTertiary,
  },
  presenceLabel: {
    fontSize: 13,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  presenceUnknown: {
    alignItems: 'center',
    columnGap: 6,
    cursor: 'help',
    display: 'flex',
    minWidth: 0,
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
  statsRow: {
    alignItems: 'center',
    columnGap: 24,
    display: 'flex',
    flexWrap: 'wrap',
    rowGap: 12,
  },
  statsValue: {
    fontSize: 20,
    fontWeight: 600,
    lineHeight: 1.2,
  },
  statsItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 72,
  },
  statsLabel: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
  },
});
