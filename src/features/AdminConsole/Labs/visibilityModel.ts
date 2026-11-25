/** Client-side facts the Labs visibility gate depends on (CUST-009). */
export interface LabsVisibilityInput {
  /** Whether the caller is an administrator. Only meaningful in `admin` mode. */
  isAdmin?: boolean;
  /**
   * Who owns `preference.lab` on this deployment, as reported by `getUserState`.
   * `undefined` until user state has loaded, and on servers that predate the
   * field — both are treated as the upstream `user` mode.
   */
  labsMode?: 'admin' | 'user';
}

/**
 * Whether the per-user Labs entry (sidebar, settings search, direct URL) must
 * be hidden.
 *
 * CUST-009: in `admin` mode the server replaces every user's `preference.lab`
 * with the console's flags, so the per-user page would toggle values nothing
 * reads. It stays available to administrators (they own the console and may
 * want the flag descriptions), and it is hidden for everyone else. Deployments
 * still in the upstream `user` mode are unaffected, and an unknown mode (user
 * state not loaded yet) fails open so the default deployment never loses the
 * page.
 *
 * Platform gates (`desktopOnly` / `workspaceOnly`) stay with each call site —
 * they describe one experiment, not the page.
 *
 * Kept free of store imports so the search index (a plain data module) can
 * share the rule without pulling the user store into its graph.
 */
export const shouldHideLabs = ({ labsMode, isAdmin }: LabsVisibilityInput): boolean =>
  labsMode === 'admin' && isAdmin !== true;
