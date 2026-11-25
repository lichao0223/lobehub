import { DEFAULT_PREFERENCE } from '@lobechat/const';
import { AdminConsoleSettingsModel, type LobeChatDatabase } from '@lobechat/database';
import type { AdminConsoleLabsConfig, UserLab } from '@lobechat/types';
import { UserLabSchema } from '@lobechat/types';

/**
 * Unified Labs switch resolver (CUST-009).
 *
 * The deployment's lab flags live in `admin_console_settings.config.labs`.
 * They are applied at READ time, so every existing consumer keeps reading
 * `preference.lab` and the upstream flag chain (client `labPreferSelectors`,
 * server gates) needs no second list:
 *
 *   effectiveLab = mode === 'user'
 *     ? baseLab                                   // upstream per-user behaviour
 *     : { ...DEFAULT_PREFERENCE.lab, ...flags }   // unset = off, never the user's own value
 *
 * This module is the single implementation; `adminConsole/labs.ts` (storage and
 * admin write) delegates here so the semantics cannot drift between the client
 * payload and the server gates.
 */

/** What a deployment without a stored `config.labs` behaves like: upstream defaults. */
export const DEFAULT_LAB_OVERRIDES: AdminConsoleLabsConfig = { flags: {}, mode: 'user' };

/**
 * The lab registry is the upstream `UserLabSchema`.
 *
 * A key that is no longer in this schema was deleted upstream, so it is an
 * orphan and must be dropped silently. (The task brief mentions
 * `DEFAULT_PREFERENCE.lab`; that object only carries the handful of flags with
 * a non-`false` default, so using it as the whitelist would drop every other
 * real lab, e.g. `enableSelfLearning`. The schema is the complete list and is
 * what storage already validates against.)
 */
const LAB_FLAG_KEYS: ReadonlySet<string> = new Set(Object.keys(UserLabSchema.shape));

/** Whether `flag` is still a lab known to this build. */
export const isKnownLabFlag = (flag: string): boolean => LAB_FLAG_KEYS.has(flag);

/**
 * Keep only known labs with a boolean value.
 *
 * Read path: unknown keys (removed upstream) and malformed values disappear
 * without throwing. Write validation lives in `adminConsole/labs.ts`.
 */
export const sanitizeLabFlags = (raw: unknown): Record<string, boolean> => {
  const flags: Record<string, boolean> = {};
  if (!raw || typeof raw !== 'object') return flags;

  for (const [key, enabled] of Object.entries(raw)) {
    if (typeof enabled !== 'boolean') continue;
    if (!LAB_FLAG_KEYS.has(key)) continue;
    flags[key] = enabled;
  }

  return flags;
};

/**
 * Uncached read of the stored config, normalized for this build.
 *
 * A missing row, malformed payload or failed query answers the upstream
 * default (`user` mode, no flags): a broken read must never silently override
 * every user's own lab preference.
 */
export const loadAdminLabsConfig = async (
  db: LobeChatDatabase,
): Promise<AdminConsoleLabsConfig> => {
  try {
    const { config } = await new AdminConsoleSettingsModel(db).getLabsConfig();

    return {
      flags: sanitizeLabFlags(config?.flags),
      mode: config?.mode === 'admin' ? 'admin' : 'user',
    };
  } catch (error) {
    console.error('[Labs] Failed to read the deployment Labs config:', error);
    return { flags: {}, mode: 'user' };
  }
};

/**
 * How long a resolved config is reused inside one process.
 *
 * The config is read on every user bootstrap and every server gate, so an
 * uncached resolve would add a settings lookup to each. Five seconds matches
 * the Agent Signal preference gate; in a multi-instance deployment each
 * instance may serve a toggle up to 5s stale, which is the accepted bound.
 */
const LAB_OVERRIDES_CACHE_TTL_MS = 5000;

interface LabOverridesCacheEntry {
  /** Bumped by a database-less invalidation so stale entries are ignored. */
  epoch: number;
  expiresAt: number;
  value: Promise<AdminConsoleLabsConfig>;
}

/**
 * Keyed by database handle so a test's PGlite instance never reuses the app's
 * cached row. Weak so an evicted handle takes its entry with it.
 */
const labOverridesCache = new WeakMap<LobeChatDatabase, LabOverridesCacheEntry>();
let labOverridesCacheEpoch = 0;

/**
 * Drop the cached config after a write (S1's admin endpoint calls this), or
 * every entry when no handle is given (tests / deploy-wide reset).
 */
export const invalidateLabOverrides = (db?: LobeChatDatabase): void => {
  if (db) {
    labOverridesCache.delete(db);
    return;
  }

  labOverridesCacheEpoch += 1;
};

/** Hot-path read used by the gates and the user bootstrap; cached for 5s. */
export const resolveLabOverrides = async (
  db: LobeChatDatabase,
): Promise<AdminConsoleLabsConfig> => {
  const now = Date.now();
  const cached = labOverridesCache.get(db);

  if (cached && cached.epoch === labOverridesCacheEpoch && cached.expiresAt > now) {
    return cached.value;
  }

  const value = loadAdminLabsConfig(db);
  labOverridesCache.set(db, {
    epoch: labOverridesCacheEpoch,
    expiresAt: now + LAB_OVERRIDES_CACHE_TTL_MS,
    value,
  });

  return value;
};

/**
 * Resolve one user's effective lab flags.
 *
 * `user` mode returns the caller's value untouched (upstream behaviour, so a
 * toggle the user never saved stays `undefined`). `admin` mode replaces it
 * with the deployment defaults plus the explicitly stored flags: an unset lab
 * is off and never falls back to the user's personal preference.
 */
export const applyLabOverrides = (
  baseLab: UserLab | null | undefined,
  overrides: AdminConsoleLabsConfig,
): UserLab | undefined =>
  overrides.mode === 'admin'
    ? { ...DEFAULT_PREFERENCE.lab, ...overrides.flags }
    : (baseLab ?? undefined);

/**
 * Single-point admin gate used by the server-side lab checks.
 *
 * `undefined` means "this deployment does not manage the flag": the caller
 * must keep its upstream per-user / per-row behaviour. A boolean is the
 * deployment answer — `true` only when the admin explicitly enabled it.
 */
export const isLabEnabledForAdminMode = (
  flag: keyof UserLab,
  overrides: AdminConsoleLabsConfig,
): boolean | undefined => (overrides.mode === 'admin' ? overrides.flags[flag] === true : undefined);

/**
 * Async convenience for server gates: reads through the same 5s cache as the
 * user bootstrap, so a gate and the client payload can never disagree.
 */
export const resolveLabGate = async (
  db: LobeChatDatabase,
  flag: keyof UserLab,
): Promise<boolean | undefined> => isLabEnabledForAdminMode(flag, await resolveLabOverrides(db));
