import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { isLobeHubModelAvailable } from '@lobechat/business-model-bank/model-config';
import { resolveBusinessModelMapping } from '@lobechat/business-model-runtime';
import type { LobeChatDatabase } from '@lobechat/database';
import type { ModelRuntimeHooks } from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import type { AiProviderRuntimeState, UserServiceModelConfig } from '@lobechat/types';
import debug from 'debug';

import {
  COMPANY_PROVIDER_ID,
  createCompanyProviderNotConfiguredError,
  getCompanyProviderRuntime,
  resolveCompanyProviderParams,
} from '@/business/server/companyProvider';
import { getBusinessModelRuntimeHooks } from '@/business/server/model-runtime';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import type { MemoryAgentConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { createUserEndpointGuardedRuntime } from '@/server/modules/ModelRuntime/userEndpointGuard';
import { getUserScopedAiProviderRuntimeState } from '@/server/services/aiProviderAccess';
import type { GlobalMemoryLayer } from '@/types/serverConfig';
import type { LayersEnum } from '@/types/userMemory';
import { resolveEmbeddingTokenLimit } from '@/utils/tokenizer/embedding';

import type { MemoryExtractionExecutorContext } from './context';
import type { ResolvedMemoryServiceConfig, RuntimeBundle } from './types';

export type ProviderKeyVaultMap = Record<
  string,
  AiProviderRuntimeState['runtimeConfig'][string]['keyVaults'] | undefined
>;

const normalizeProvider = (provider: string) => provider.toLowerCase();

const extractCredentialsFromVault = (vault?: Record<string, unknown>) => {
  if (!vault || typeof vault !== 'object') return {};

  const apiKey = 'apiKey' in vault && typeof vault.apiKey === 'string' ? vault.apiKey : undefined;
  const baseURL =
    'baseURL' in vault && typeof vault.baseURL === 'string' ? vault.baseURL : undefined;

  return { apiKey, baseURL };
};

export const resolveLayerModels = (
  layers: Partial<Record<GlobalMemoryLayer, string>> | undefined,
  fallback: Record<GlobalMemoryLayer, string>,
): Record<LayersEnum, string> => ({
  activity: layers?.activity ?? fallback.activity,
  context: layers?.context ?? fallback.context,
  experience: layers?.experience ?? fallback.experience,
  identity: layers?.identity ?? fallback.identity,
  preference: layers?.preference ?? fallback.preference,
});

const maskSecret = (value?: string) => {
  if (!value) return 'undefined';
  if (value.length <= 8) return `${value[0]}***${value.at(-1)}`;

  return `${value.slice(0, 6)}***${value.slice(-4)}`;
};

export type ProviderCredential = { apiKey?: string; baseURL?: string };

export type RuntimeResolveOptions = {
  /**
   * Company-provider credential read asynchronously by a background caller, see
   * {@link resolveCompanyProviderCredential}. Without it a background task only
   * sees the synchronous process cache — which nothing in a fresh worker may
   * have warmed yet, and which every bundled copy of the module keeps apart.
   */
  companyCredential?: ProviderCredential | null;
  fallback?: ProviderCredential;
  /** Slot name used in logs (`embedding` / `gatekeeper` / `layer extractor`). */
  label?: string;
  preferred?: {
    providerIds?: string[];
  };
  userId?: string;
};

/**
 * Join a caller-resolved company credential with the synchronous fallbacks.
 *
 * Priority: the credential the background caller just read from the console →
 * the 5 s process snapshot → the `TELLHOW_*` deployment env. A credential that
 * only carries half of the pair is ignored so the next layer can supply both.
 */
const resolveCompanyProviderParamsForAgent = (credential?: ProviderCredential | null) =>
  credential?.apiKey && credential.baseURL
    ? { apiKey: credential.apiKey, baseURL: credential.baseURL }
    : resolveCompanyProviderParams({});

/**
 * Console credential for the memory slots that follow the administrator
 * default, or `undefined` when no slot needs it and `null` when the deployment
 * has not configured the service.
 *
 * Background tasks (memory extraction, persona writer, consolidation) call this
 * before resolving their runtimes: `getCompanyProviderRuntime` reads the
 * console row asynchronously and refreshes the shared 5 s cache, so the run
 * neither depends on a chat request having warmed the snapshot first nor on a
 * deployment env that an administrator's console config is supposed to replace.
 */
export const resolveCompanyProviderCredential = async (
  db: LobeChatDatabase,
  agents: readonly MemoryAgentConfig[],
): Promise<ProviderCredential | null | undefined> => {
  const needsCompanyProvider = agents.some(
    (agent) => normalizeProvider(agent.provider || '') === COMPANY_PROVIDER_ID,
  );
  if (!needsCompanyProvider) return undefined;

  const runtime = await getCompanyProviderRuntime(db);

  return runtime ? { apiKey: runtime.apiKey, baseURL: runtime.baseURL } : null;
};

export const resolveRuntimeAgentConfig = (
  agent: MemoryAgentConfig,
  keyVaults?: ProviderKeyVaultMap,
  options?: RuntimeResolveOptions,
  hooks?: ModelRuntimeHooks,
) => {
  const label = options?.label ?? 'agent';

  // CUST-011: a slot that follows the administrator default resolves to
  // tellhow, whose endpoint and key live on the server (admin console
  // settings), never in a user vault. Resolve them the same way a chat request
  // does instead of building a keyless runtime that fails on every call.
  if (normalizeProvider(agent.provider || '') === COMPANY_PROVIDER_ID) {
    const params = resolveCompanyProviderParamsForAgent(options?.companyCredential);
    if (params) {
      return ModelRuntime.initializeWithProvider(
        COMPANY_PROVIDER_ID,
        { ...params, userId: options?.userId },
        hooks,
      );
    }

    // Falling through would log "missing API key in user vault" and build a
    // keyless tellhow runtime, which fails later with an opaque
    // InvalidProviderAPIKey. Name the slot and fail with the readable error the
    // chat path already returns for a disabled / unconfigured service.
    console.error(
      `[memory-extraction] ${label} cannot resolve the company provider: the admin console has no credentials and TELLHOW_API_KEY / TELLHOW_PROXY_URL are unset`,
    );
    throw createCompanyProviderNotConfiguredError();
  }

  const normalizedPreferredProviders = (options?.preferred?.providerIds || [])
    .map(normalizeProvider)
    .filter(Boolean);

  const providerOrder = Array.from(
    new Set([
      ...normalizedPreferredProviders,
      normalizeProvider(agent.provider || 'openai'),
      ...Object.keys(keyVaults || {}),
    ]),
  );

  for (const provider of providerOrder) {
    if (provider === 'lobehub') {
      debugRuntimeInit(agent, {
        provider,
        source: 'user-vault' as const,
      });

      return ModelRuntime.initializeWithProvider(provider, { userId: options?.userId }, hooks);
    }

    const { apiKey: userApiKey, baseURL: userBaseURL } = extractCredentialsFromVault(
      keyVaults?.[provider],
    );
    if (!userApiKey) {
      console.warn(
        `[memory-extraction] ${label} skipping provider ${provider} due to missing API key in user vault`,
      );
      continue;
    }

    debugRuntimeInit(agent, {
      apiKey: userApiKey,
      baseURL: userBaseURL,
      provider,
      source: 'user-vault' as const,
    });

    // Only use the user baseURL if we are also using their API key; otherwise fall back entirely
    // to system config to avoid mixing credentials.
    return new ModelRuntime(
      createUserEndpointGuardedRuntime({
        create: () =>
          ModelRuntime.createProviderRuntime(provider, {
            apiKey: userApiKey,
            baseURL: userBaseURL,
            userId: options?.userId,
          }),
        endpoints: [userBaseURL],
        provider,
      }),
    );
  }

  debugRuntimeInit(agent, {
    apiKey: agent.apiKey || options?.fallback?.apiKey,
    baseURL: agent.baseURL || options?.fallback?.baseURL,
    provider: agent.provider || 'openai',
    source: 'system-config' as const,
  });

  return ModelRuntime.initializeWithProvider(agent.provider || 'openai', {
    apiKey: agent.apiKey || options?.fallback?.apiKey,
    baseURL: agent.baseURL || options?.fallback?.baseURL,
    userId: options?.userId,
  });
};

const logRuntime = debug('lobe-server:memory:user-memory:runtime');

const debugRuntimeInit = (
  agent: MemoryAgentConfig,
  resolved: {
    apiKey?: string;
    baseURL?: string;
    provider: string;
    source: 'user-vault' | 'system-config';
  },
) => {
  if (!logRuntime.enabled) return;
  logRuntime('init runtime', {
    agentModel: agent.model,
    agentProvider: agent.provider || 'openai',
    apiKey: maskSecret(resolved.apiKey),
    baseURL: resolved.baseURL,
    provider: resolved.provider,
    source: resolved.source,
  });
};

const MEMORY_MODEL_SETTINGS = [
  ['memoryAnalysisAgentConfig', 'chat'],
  ['userMemoryEmbedding', 'embedding'],
  ['userMemoryPersonaWriter', 'chat'],
] as const;

/**
 * Drops a user's memory model choice when it names a LobeHub model that is no longer served, so
 * extraction falls back to the platform default instead of failing every run with
 * `LobeHubModelDeprecated`. Choices on other providers are the user's to fix and stay as set.
 */
export async function withoutRetiredLobeHubMemoryModels(
  systemAgent: Partial<UserServiceModelConfig> | undefined,
  userEmail?: string | null,
): Promise<Partial<UserServiceModelConfig> | undefined> {
  if (!systemAgent) return systemAgent;
  let result = systemAgent;
  for (const [key, type] of MEMORY_MODEL_SETTINGS) {
    const item = systemAgent[key];
    if (item?.provider !== BRANDING_PROVIDER || !item.model) continue;
    const { resolvedModelId } = await resolveBusinessModelMapping(item.provider, item.model);
    if (await isLobeHubModelAvailable(resolvedModelId, type, { userEmail })) continue;
    const { [key]: _retired, ...rest } = result;
    result = rest;
  }
  return result;
}

/** Memory slots that may follow a deployment default (CUST-011 §7.1). */
const MEMORY_SERVICE_SLOTS = ['memoryAnalysisAgentConfig', 'userMemoryEmbedding'] as const;

/**
 * Layer the user's own memory picks over the deployment defaults.
 *
 * `deploymentSystemAgent` is `serverConfig.systemAgent`, which already merges
 * the administrator console defaults above `SYSTEM_AGENT` (CUST-011), so this
 * is the same chain the client shows: user pick → administrator → env → the
 * memory env / code default that `privateConfig` already provides.
 *
 * Only the slots memory extraction actually runs are copied: `fileEmbedding`
 * belongs to `DEFAULT_FILES_CONFIG`, and the chat slots belong to other
 * callers. A user row always wins, including an explicit `enabled: false`.
 */
export function withMemoryDeploymentDefaults(
  userSystemAgent: Partial<UserServiceModelConfig> | undefined,
  deploymentSystemAgent: Partial<UserServiceModelConfig> | undefined,
): Partial<UserServiceModelConfig> | undefined {
  if (!deploymentSystemAgent) return userSystemAgent;

  const merged: Partial<UserServiceModelConfig> = { ...userSystemAgent };

  for (const slot of MEMORY_SERVICE_SLOTS) {
    if (!merged[slot] && deploymentSystemAgent[slot]) merged[slot] = deploymentSystemAgent[slot];
  }

  return merged;
}

export function resolveUserMemoryAgent(
  systemAgent: Partial<UserServiceModelConfig> | undefined,
  key: keyof Pick<
    UserServiceModelConfig,
    'userMemoryEmbedding' | 'memoryAnalysisAgentConfig' | 'userMemoryPersonaWriter'
  >,
  fallback: MemoryAgentConfig,
): MemoryAgentConfig {
  const override = systemAgent?.[key];
  const provider = override?.provider || fallback.provider;
  const shouldInheritCredentials =
    !override?.provider ||
    normalizeProvider(override.provider) === normalizeProvider(fallback.provider || 'openai');
  const contextLimit =
    typeof override?.contextLimit === 'number' &&
    Number.isFinite(override.contextLimit) &&
    override.contextLimit > 0
      ? Math.floor(override.contextLimit)
      : fallback.contextLimit;

  return {
    apiKey: shouldInheritCredentials ? fallback.apiKey : undefined,
    baseURL: shouldInheritCredentials ? fallback.baseURL : undefined,
    contextLimit,
    language: fallback.language,
    model: override?.model || fallback.model,
    provider,
  };
}

export function resolveUserMemoryServiceConfig(
  ctx: MemoryExtractionExecutorContext,
  systemAgent?: Partial<UserServiceModelConfig>,
): ResolvedMemoryServiceConfig {
  const gatekeeper = ctx.resolveUserMemoryAgent(
    systemAgent,
    'memoryAnalysisAgentConfig',
    ctx.privateConfig.agentGateKeeper,
  );
  const layerExtractor = ctx.resolveUserMemoryAgent(
    systemAgent,
    'memoryAnalysisAgentConfig',
    ctx.privateConfig.agentLayerExtractor,
  );
  const embedding = ctx.resolveUserMemoryAgent(
    systemAgent,
    'userMemoryEmbedding',
    ctx.privateConfig.embedding,
  );
  const layerModels = systemAgent?.memoryAnalysisAgentConfig?.model
    ? {
        activity: layerExtractor.model,
        context: layerExtractor.model,
        experience: layerExtractor.model,
        identity: layerExtractor.model,
        preference: layerExtractor.model,
      }
    : resolveLayerModels(undefined, ctx.privateConfig.agentLayerExtractor.layers);

  return {
    agents: {
      embedding,
      gatekeeper,
      layerExtractor,
    },
    embeddingContextLimit:
      resolveEmbeddingTokenLimit(embedding.model, embedding.contextLimit) ??
      layerExtractor.contextLimit,
    extractorContextLimit: layerExtractor.contextLimit,
    modelConfig: {
      embeddingsModel: embedding.model,
      gateModel: gatekeeper.model,
      layerModels,
      observabilityS3: ctx.privateConfig.observabilityS3,
    },
    overrides: {
      embedding: {
        model: Boolean(systemAgent?.userMemoryEmbedding?.model),
        provider: Boolean(systemAgent?.userMemoryEmbedding?.provider),
      },
      gatekeeper: {
        model: Boolean(systemAgent?.memoryAnalysisAgentConfig?.model),
        provider: Boolean(systemAgent?.memoryAnalysisAgentConfig?.provider),
      },
      layerExtractor: {
        model: Boolean(systemAgent?.memoryAnalysisAgentConfig?.model),
        provider: Boolean(systemAgent?.memoryAnalysisAgentConfig?.provider),
      },
    },
  };
}

export async function getAiProviderRuntimeState(
  ctx: MemoryExtractionExecutorContext,
  userId: string,
  workspaceId?: string,
): Promise<AiProviderRuntimeState> {
  const db = await ctx.db;
  const aiInfraRepos = new AiInfraRepos(db, userId, ctx.aiProviderConfig, workspaceId);

  return getUserScopedAiProviderRuntimeState(
    userId,
    () => aiInfraRepos.getAiProviderRuntimeState(KeyVaultsGateKeeper.getUserKeyVaults),
    { throwOnUnresolvedAccess: true },
  );
}

export async function resolveRuntimeKeyVaults(
  ctx: MemoryExtractionExecutorContext,
  runtimeState: AiProviderRuntimeState,
  memoryServiceConfig: ResolvedMemoryServiceConfig,
): Promise<ProviderKeyVaultMap> {
  const normalizedRuntimeConfig = Object.fromEntries(
    Object.entries(runtimeState.runtimeConfig || {}).map(([providerId, config]) => [
      normalizeProvider(providerId),
      config,
    ]),
  );

  const keyVaults: ProviderKeyVaultMap = {};

  const gatekeeperProvider = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
    fallbackProvider: memoryServiceConfig.agents.gatekeeper.provider,
    label: 'gatekeeper',
    modelId: memoryServiceConfig.modelConfig.gateModel,
    preferredModels: memoryServiceConfig.overrides.gatekeeper.model
      ? undefined
      : ctx.gatekeeperPreferredModels,
    preferredProviders: memoryServiceConfig.overrides.gatekeeper.provider
      ? undefined
      : ctx.gatekeeperPreferredProviders,
  });
  const gatekeeperRuntime = normalizedRuntimeConfig[gatekeeperProvider];
  if (gatekeeperRuntime?.keyVaults) {
    keyVaults[gatekeeperProvider] = gatekeeperRuntime.keyVaults;
  }

  const embeddingProvider = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
    fallbackProvider: memoryServiceConfig.agents.embedding.provider,
    label: 'embedding',
    modelId: memoryServiceConfig.modelConfig.embeddingsModel,
    preferredModels: memoryServiceConfig.overrides.embedding.model
      ? undefined
      : ctx.embeddingPreferredModels,
    preferredProviders: memoryServiceConfig.overrides.embedding.provider
      ? undefined
      : ctx.embeddingPreferredProviders,
  });
  const embeddingRuntime = normalizedRuntimeConfig[embeddingProvider];
  if (embeddingRuntime?.keyVaults) {
    keyVaults[embeddingProvider] = embeddingRuntime.keyVaults;
  }

  for (const model of Object.values(memoryServiceConfig.modelConfig.layerModels)) {
    if (!model) continue;
    const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
      fallbackProvider: memoryServiceConfig.agents.layerExtractor.provider,
      label: 'layer extractor',
      modelId: model,
      preferredModels: memoryServiceConfig.overrides.layerExtractor.model
        ? undefined
        : ctx.layerPreferredModels,
      preferredProviders: memoryServiceConfig.overrides.layerExtractor.provider
        ? undefined
        : ctx.layerPreferredProviders,
    });
    const runtime = normalizedRuntimeConfig[providerId];
    if (runtime?.keyVaults) {
      keyVaults[providerId] = runtime.keyVaults;
    }
  }

  return keyVaults;
}

/**
 * Stand-in for a slot whose provider could not be built at all (no key, no
 * endpoint). Every call rejects with the original reason.
 *
 * Only the embedding slot uses it: the caller marks the bundle
 * `embeddingsAvailable: false` and skips vector retrieval, while the persist
 * path already tolerates a missing vector (`generateEmbeddings` returns nulls).
 * An unconfigured embedding provider must not abort a run before the analysis
 * model ever gets a request.
 */
const unavailableRuntime = (reason: unknown): ModelRuntime => {
  const fail = async (): Promise<never> => {
    throw reason;
  };

  return new ModelRuntime({
    chat: fail,
    embeddings: fail,
    generateObject: fail,
    models: fail,
  });
};

/** Resolve the embedding slot, degrading to a rejecting runtime instead of aborting the run. */
const resolveEmbeddingRuntime = (
  resolve: () => ModelRuntime,
): { embeddings: ModelRuntime; embeddingsAvailable: boolean } => {
  try {
    return { embeddings: resolve(), embeddingsAvailable: true };
  } catch (error) {
    console.warn(
      '[memory-extraction] embedding runtime unavailable, memories will be stored without vectors',
      error,
    );

    return { embeddings: unavailableRuntime(error), embeddingsAvailable: false };
  }
};

export async function getRuntime(
  ctx: MemoryExtractionExecutorContext,
  userId: string,
  memoryServiceConfig: ResolvedMemoryServiceConfig,
  keyVaults?: ProviderKeyVaultMap,
): Promise<RuntimeBundle> {
  // TODO: implement a better cache eviction strategy
  // TODO: make cache size configurable
  if (ctx.runtimeCache.keys.length > 200) {
    ctx.runtimeCache.clear();
  }

  const cacheKey = [
    userId,
    memoryServiceConfig.agents.embedding.provider,
    memoryServiceConfig.agents.gatekeeper.provider,
    memoryServiceConfig.agents.layerExtractor.provider,
  ].join(':');
  const cached = ctx.runtimeCache.get(cacheKey);
  if (cached) return cached;

  // CUST-011: read the console config here, asynchronously, with this run's db
  // handle. The synchronous snapshot in `resolveCompanyProviderParams` is only
  // populated by whichever module copy happened to read it earlier, so a
  // background job must not depend on it (T-104).
  const db = await ctx.db;
  const companyCredential = await resolveCompanyProviderCredential(db, [
    memoryServiceConfig.agents.embedding,
    memoryServiceConfig.agents.gatekeeper,
    memoryServiceConfig.agents.layerExtractor,
  ]);

  const embeddingOptions: RuntimeResolveOptions = {
    companyCredential,
    fallback: {
      apiKey: memoryServiceConfig.agents.embedding.apiKey,
      baseURL: memoryServiceConfig.agents.embedding.baseURL,
    },
    label: 'embedding',
    preferred: {
      providerIds: memoryServiceConfig.overrides.embedding.provider
        ? undefined
        : ctx.embeddingPreferredProviders,
    },
    userId,
  };

  const gatekeeperOptions: RuntimeResolveOptions = {
    companyCredential,
    fallback: {
      apiKey: memoryServiceConfig.agents.gatekeeper.apiKey,
      baseURL: memoryServiceConfig.agents.gatekeeper.baseURL,
    },
    label: 'gatekeeper',
    preferred: {
      providerIds: memoryServiceConfig.overrides.gatekeeper.provider
        ? undefined
        : ctx.gatekeeperPreferredProviders,
    },
    userId,
  };

  const layerExtractorOptions: RuntimeResolveOptions = {
    companyCredential,
    fallback: {
      apiKey: memoryServiceConfig.agents.layerExtractor.apiKey,
      baseURL: memoryServiceConfig.agents.layerExtractor.baseURL,
    },
    label: 'layer extractor',
    preferred: {
      providerIds: memoryServiceConfig.overrides.layerExtractor.provider
        ? undefined
        : ctx.layerPreferredProviders,
    },
    userId,
  };

  const hooks = getBusinessModelRuntimeHooks(userId, 'lobehub');
  const embedding = resolveEmbeddingRuntime(() =>
    resolveRuntimeAgentConfig(
      memoryServiceConfig.agents.embedding,
      keyVaults,
      embeddingOptions,
      hooks,
    ),
  );

  const runtimes: RuntimeBundle = {
    embeddings: embedding.embeddings,
    embeddingsAvailable: embedding.embeddingsAvailable,
    gatekeeper: await resolveRuntimeAgentConfig(
      memoryServiceConfig.agents.gatekeeper,
      keyVaults,
      gatekeeperOptions,
      hooks,
    ),
    layerExtractor: await resolveRuntimeAgentConfig(
      memoryServiceConfig.agents.layerExtractor,
      keyVaults,
      layerExtractorOptions,
      hooks,
    ),
  };

  ctx.runtimeCache.set(cacheKey, runtimes);

  return runtimes;
}
