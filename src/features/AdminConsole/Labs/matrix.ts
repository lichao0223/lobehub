import { ALL_LAB_FEATURES, type LabFeatureItem } from '@/features/Settings/labs/features';
import { labPreferSelectors } from '@/store/user/slices/preference/selectors/labPrefer';

/**
 * Rows of the admin Labs matrix (CUST-009).
 *
 * The list is derived, never maintained by hand:
 * - `ALL_LAB_FEATURES` is the upstream Labs page source (including experiments
 *   this deployment hides), so a new / renamed / removed upstream lab follows
 *   automatically and the matrix holds exactly one row per upstream entry;
 * - selectors under `labPreferSelectors` that have no Labs page entry
 *   (e.g. `enableTaskVerify`) are rendered in their own section by
 *   `getLabExtraSwitches`, never inside the matrix, so the matrix row count
 *   stays comparable with the upstream catalog.
 *
 * Adding either in upstream is enough for it to appear here.
 */
export type LabMatrixRow =
  | { feature: LabFeatureItem; flag: LabFeatureItem['flag']; kind: 'feature' }
  | { flag: keyof typeof labPreferSelectors; kind: 'extra' };

/**
 * Flags the admin page cannot promise on its own.
 *
 * `readOnly` rows are shown for visibility but not switchable: the outcome is
 * also gated by a deployment-level setting, so a switch here would not be
 * truthful. The note explains what else must change.
 */
export const LAB_FLAG_READ_ONLY: Partial<Record<string, 'pageCollabDeployment'>> = {
  enablePageCollab: 'pageCollabDeployment',
};

export interface LabRowAvailability {
  /** The switch is shown but cannot be flipped here. */
  readOnly: boolean;
  /** The deployment cannot run this experiment at all (e.g. business-only). */
  unavailable: boolean;
}

/**
 * Whether a row can be edited on this deployment.
 *
 * `businessOnly` experiments need a service a self-hosted deployment does not
 * have, so switching them on here would do nothing; they are dimmed instead of
 * silently stored. `LAB_FLAG_READ_ONLY` rows are also gated elsewhere.
 */
export const getLabRowAvailability = (
  row: LabMatrixRow,
  businessFeaturesEnabled: boolean,
): LabRowAvailability => ({
  readOnly: Boolean(LAB_FLAG_READ_ONLY[row.flag]),
  unavailable:
    row.kind === 'feature' && row.feature.businessOnly === true && !businessFeaturesEnabled,
});

/**
 * Selector-only rows that already have upstream copy, mapped to their `labs`
 * locale stem (`features.${stem}.title|desc`).
 *
 * Admin rows are otherwise titled by their raw flag. Copy does not make the row
 * a lab with a toggle: `enableTaskVerify` is read by the thread UI only, so it
 * has upstream wording but no Labs page switch.
 */
export const LAB_EXTRA_COPY_STEM: Readonly<Partial<Record<string, 'taskVerify'>>> = {
  enableTaskVerify: 'taskVerify',
};

/** A selector-only row has no toggle on the user-facing Labs page. */
export const isSelectorOnlyRow = (row: LabMatrixRow): boolean => row.kind === 'extra';

/**
 * Badges the admin matrix shows next to one row, in display order.
 *
 * The narrowing badges (`desktopOnly` / `workspaceOnly` / `businessOnly`) come
 * from the catalog entry, so a lab upstream narrows to one shell or to workspace
 * users is labelled without a second registration. `noSettingsEntry` marks a
 * selector-only row, whose switch has no equivalent on the user-facing Labs page.
 */
export type LabRowBadge = 'businessOnly' | 'desktopOnly' | 'noSettingsEntry' | 'workspaceOnly';

export const getLabRowBadges = (row: LabMatrixRow): LabRowBadge[] => {
  // Every selector-only row is labelled, including the one that has upstream
  // copy: the badge is what tells an admin this switch exists nowhere else.
  if (row.kind === 'extra') return ['noSettingsEntry'];

  const badges: LabRowBadge[] = [];
  if (row.feature.desktopOnly) badges.push('desktopOnly');
  if (row.feature.workspaceOnly) badges.push('workspaceOnly');
  if (row.feature.businessOnly) badges.push('businessOnly');

  return badges;
};

/**
 * The experiment matrix: exactly one row per upstream `ALL_LAB_FEATURES` entry,
 * in upstream order. Never append anything else here — selector-only switches
 * live in `getLabExtraSwitches` so the row count stays a faithful mirror.
 */
export const getLabMatrixRows = (): LabMatrixRow[] =>
  ALL_LAB_FEATURES.map<LabMatrixRow>((feature) => ({
    feature,
    flag: feature.flag,
    kind: 'feature',
  }));

/**
 * Switches that exist in `labPreferSelectors` but have no Labs settings entry.
 *
 * Rendered in their own card below the matrix (still switchable in admin mode),
 * so they are controllable without inflating the matrix's row count.
 */
export const getLabExtraSwitches = (): LabMatrixRow[] => {
  const featureFlags = new Set(ALL_LAB_FEATURES.map(({ flag }) => flag as string));

  return (Object.keys(labPreferSelectors) as Array<keyof typeof labPreferSelectors>)
    .filter((flag) => !featureFlags.has(flag))
    .sort()
    .map<LabMatrixRow>((flag) => ({ flag, kind: 'extra' }));
};
