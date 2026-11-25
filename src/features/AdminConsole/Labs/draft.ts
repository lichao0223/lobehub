import { DEFAULT_PREFERENCE } from '@/const/user';

/**
 * Draft helpers for the admin Labs matrix (CUST-009).
 *
 * Kept out of the component so the save contract is testable without rendering:
 * the stored map is sparse (only values that differ from the upstream default),
 * and "dirty" must compare that sparse form rather than the visible switches.
 */

export const defaultFlagValue = (flag: string): boolean =>
  (DEFAULT_PREFERENCE.lab as Record<string, boolean | undefined> | undefined)?.[flag] === true;

/** Only values that differ from the upstream default are stored (sparse map). */
export const toSparseFlags = (flags: Record<string, boolean>): Record<string, boolean> =>
  Object.fromEntries(
    Object.entries(flags).filter(([flag, value]) => value !== defaultFlagValue(flag)),
  );

/**
 * Stable identity of a draft. Comparing this instead of the rendered map keeps
 * "not dirty" when a switch is flipped back to its stored value.
 */
export const flagsFingerprint = (flags: Record<string, boolean>): string => {
  const sparse = toSparseFlags(flags);
  return Object.keys(sparse)
    .sort()
    .map((key) => `${key}:${String(sparse[key])}`)
    .join(',');
};
