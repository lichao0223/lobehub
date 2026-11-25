import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { densityTokens } from '@/styles/density.stylex';

/** experiment (title / description / flag) | availability badges | switch */
export const LAB_MATRIX_COLUMNS = 'minmax(320px, 3fr) minmax(120px, 1fr) 64px';

export const styles = stylex.create({
  card: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: densityTokens['--lobe-density-radius'],
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: densityTokens['--lobe-density-content-gap'],
    padding: densityTokens['--lobe-density-card-padding'],
  },
  cardHeader: {
    alignItems: 'flex-start',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: cssVar.colorText,
    fontSize: densityTokens['--lobe-density-page-title-font-size'],
    fontWeight: 600,
    lineHeight: 1.5,
  },
  cardDesc: {
    color: cssVar.colorTextSecondary,
    fontSize: 12,
    lineHeight: 1.6,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: cssVar.colorBorderSecondary,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    columnGap: 12,
    display: 'grid',
    minHeight: densityTokens['--lobe-density-list-row-height'],
    paddingBlock: 8,
    paddingInline: 12,
  },
  rowLast: {
    borderBottomWidth: 0,
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
  flagCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  flagTitle: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  flagDesc: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    lineHeight: 1.6,
  },
  flagCode: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
  },
  badges: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  mono: {
    color: cssVar.colorTextTertiary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
  },
  toolbar: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
});
