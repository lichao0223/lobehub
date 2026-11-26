import { SERVICE_MODEL_TIER_SLOTS } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type {
  AdminConsoleAiDefaults,
  ServiceModelTier,
  SystemAgentItem,
  UserServiceModelConfigKey,
} from '@lobechat/types';

import {
  COMPANY_PROVIDER_ID,
  type CompanyProviderOptions,
  type CompanyProviderRuntime,
  getCompanyProviderRuntimeFromServer,
  getVisibleCompanyModels,
} from '../companyProvider';

/**
 * Administrator defaults → deployment defaults (CUST-011,
 * `ADMIN_CONSOLE_DESIGN.md` §7.1).
 *
 * `config.ai.defaults` was stored by the console and read by nothing. This
 * module is the single translation from those four model ids to the two layers
 * a deployment default has:
 *
 * - `systemAgent`: every task slot of the tier each id feeds, and
 * - `defaultAgent.config`: the new-conversation model (`defaults.chat`).
 *
 * Only the administrator layer is resolved here. Callers merge it above
 * `SYSTEM_AGENT` / `DEFAULT_AGENT_CONFIG`, so a tier the administrator left
 * unset keeps the deployment's environment default. Nothing is written to a
 * user row: following happens on read, which is what lets a later change by the
 * administrator reach users who never picked a model themselves.
 */

/** Which `defaults` id feeds each Service Model tier (`SERVICE_MODEL_TIER_SLOTS`). */
const TIER_DEFAULTS_KEY: Record<ServiceModelTier, keyof AdminConsoleAiDefaults> = {
  embedding: 'embedding',
  flash: 'title',
  main: 'chat',
  verify: 'verify',
};

export interface CompanyServiceDefaults {
  /** New-conversation default model; absent when `defaults.chat` is unusable. */
  defaultAgent?: { config: SystemAgentItem };
  /** Slot → administrator default, only for tiers that resolved. */
  systemAgent: Partial<Record<UserServiceModelConfigKey, SystemAgentItem>>;
  /** Per-tier result, for background callers that resolve a single slot. */
  tiers: Partial<Record<ServiceModelTier, SystemAgentItem>>;
}

const emptyDefaults = (): CompanyServiceDefaults => ({ systemAgent: {}, tiers: {} });

/**
 * Resolve the administrator layer from a runtime. Total by design: a closed
 * service, an unset id, or an id users cannot see all read as "not configured",
 * so the caller falls through to the next layer instead of sending a model that
 * would fail at request time.
 *
 * The slot list is not repeated here — it comes from `SERVICE_MODEL_TIER_SLOTS`,
 * so a slot added upstream is covered without editing this file.
 */
export const resolveCompanyServiceDefaults = (
  runtime: CompanyProviderRuntime | null | undefined,
): CompanyServiceDefaults => {
  const defaults = runtime?.defaults;
  if (!runtime || !defaults) return emptyDefaults();

  // `getCompanyProviderRuntime` already drops closed/removed models; filtering
  // again keeps a manually built runtime from turning one into a default.
  const visible = new Set(getVisibleCompanyModels(runtime.models ?? []).map((model) => model.id));

  const result = emptyDefaults();

  for (const tier of Object.keys(SERVICE_MODEL_TIER_SLOTS) as ServiceModelTier[]) {
    const model = defaults[TIER_DEFAULTS_KEY[tier]]?.trim();

    // Unset, unknown or no-longer-offered (closed / removed upstream) ids must
    // not become a default — they fall through to the next layer.
    if (!model || !visible.has(model)) continue;

    const item: SystemAgentItem = { model, provider: COMPANY_PROVIDER_ID };
    result.tiers[tier] = item;

    for (const slot of SERVICE_MODEL_TIER_SLOTS[tier]) result.systemAgent[slot] = item;
  }

  // `defaults.chat` doubles as the new-conversation default; `tiers.main` is the
  // same id after the availability check above.
  if (result.tiers.main) result.defaultAgent = { config: { ...result.tiers.main } };

  return result;
};

/**
 * Read the administrator layer through the shared `getCompanyProviderRuntime`
 * 5 s cache — the global config must not add a second settings read path.
 */
export const getCompanyServiceDefaults = async (
  options: CompanyProviderOptions & { db?: LobeChatDatabase } = {},
): Promise<CompanyServiceDefaults> =>
  resolveCompanyServiceDefaults(await getCompanyProviderRuntimeFromServer(options));
