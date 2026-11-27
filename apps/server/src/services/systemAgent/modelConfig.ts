import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type {
  SystemAgentItem,
  UserServiceModelConfig,
  UserSystemAgentConfigKey,
} from '@lobechat/types';

import { getCompanyServiceDefaultModel } from '@/business/server/adminConsole/serviceDefaults';
import { appEnv } from '@/envs/app';
import { parseSystemAgent } from '@/server/globalConfig/parseSystemAgent';

/** Administrator service defaults keyed by slot (CUST-011), from one resolved read. */
export type SystemAgentAdminDefaults = Partial<Record<UserSystemAgentConfigKey, SystemAgentItem>>;

interface ResolveSystemAgentModelConfigParams {
  /**
   * Already-resolved administrator layer. Omit to read it through the shared
   * company-provider cache; pass `{}` to say "the administrator set nothing".
   */
  adminDefaults?: SystemAgentAdminDefaults;
  /** Already-parsed `SYSTEM_AGENT`; omit to parse the env per call. */
  envDefaults?: Partial<UserServiceModelConfig>;
  override?: Partial<Pick<SystemAgentItem, 'model' | 'provider'>>;
  taskConfig?: Partial<SystemAgentItem>;
  taskKey: UserSystemAgentConfigKey;
}

/**
 * The model one system-agent task runs on in the background.
 *
 * Chain (CUST-011 §7.1), identical to what the client applies to
 * `defaultSettings.systemAgent` so a task and its settings page agree:
 *
 *   caller override → user pick → administrator default → `SYSTEM_AGENT` → code default
 *
 * The administrator layer is read through B1's `getCompanyServiceDefaultModel`
 * (the same 5 s company-provider cache, no second settings read path) and only
 * when a higher layer left a field open — a task with a full user pick never
 * touches the settings row. Callers that already resolved the layer pass it in
 * instead of resolving it twice.
 *
 * `SYSTEM_AGENT` now sits in the chain as well: before CUST-011 this resolver
 * ignored it entirely, so background tasks never saw the deployment default
 * the settings page showed.
 */
export const resolveSystemAgentModelConfig = async ({
  adminDefaults,
  envDefaults,
  override,
  taskConfig,
  taskKey,
}: ResolveSystemAgentModelConfigParams): Promise<{ model: string; provider: string }> => {
  const codeDefault = DEFAULT_SYSTEM_AGENT_CONFIG[taskKey];

  let model = override?.model || taskConfig?.model;
  let provider = override?.provider || taskConfig?.provider;

  if (!model || !provider) {
    const admin =
      adminDefaults === undefined
        ? await getCompanyServiceDefaultModel(taskKey)
        : adminDefaults[taskKey];

    model ||= admin?.model;
    provider ||= admin?.provider;
  }

  if (!model || !provider) {
    const env = (envDefaults ?? parseSystemAgent(appEnv.SYSTEM_AGENT))[taskKey];

    model ||= env?.model;
    provider ||= env?.provider;
  }

  return { model: model || codeDefault.model, provider: provider || codeDefault.provider };
};
