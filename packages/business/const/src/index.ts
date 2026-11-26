import { BRANDING_PROVIDER } from './branding';

export * from './branding';
export * from './llm';
export * from './oidc';
export * from './url';

export const ENABLE_BUSINESS_FEATURES = false;

/**
 * CUST-011-C — 厂商默认开关：除企业内置厂商（Tellhow AI）外全部默认关闭。
 *
 * 「默认关闭」不是「禁止」：服务端默认值只是新用户看到的初始状态，
 * `AiInfraRepos.getAiProviderList()` 的合并语义是
 * 「用户 `ai_provider.enabled` **或** 服务端 `aiProvider[id].enabled`」，
 * 所以用户自己打开某个厂商后照常可用；自定义厂商（`source: 'custom'`）
 * 来自用户行，不经过这份默认值，完全不受影响。
 *
 * 生效位置：`apps/server/src/globalConfig/index.ts` 的
 * `getAiProviderSpecificConfig()` 把内置厂商的 `enabled` 显式写成
 * `provider === COMPANY_PROVIDER_ID`。管理员关闭 Tellhow 时由
 * `withCompanyProviderCatalog()` 再覆盖成 `false`，与这里的默认值无关。
 *
 * 它不参与服务端模型解析：`initModelRuntimeFromDB()` 只读用户 / 厂商行与
 * 控制台凭据，不读这份默认值，所以标题、记忆、验收等后台任务不受影响
 * （`apps/server/src/modules/ModelRuntime/providerDefaults.test.ts` 用真实
 * 初始化路径锁住这一点）。
 *
 * 与 `ENABLE_BUSINESS_FEATURES` 无关：后者语义不变（业务特性 / 网关 / 协作），
 * 本开关只决定「用户没选过时哪些厂商是开着的」。注意：开启本开关后，
 * 内置厂商的 `ENABLED_*` 环境变量不再把该厂商在用户侧默认打开（凭据仍然
 * 生效，用户在设置里打开即可用）；需要另一个默认开启的厂商时，在
 * `getAiProviderSpecificConfig()` 里显式放行，而不是改 `ENABLE_BUSINESS_FEATURES`。
 */
export const DEFAULT_ONLY_COMPANY_PROVIDER_ENABLED = true;

/**
 * Whether Settings → Tools (per-user search provider / crawler ordering) is
 * exposed. The server still honors preferences already saved; this only
 * controls the entry. Distributions can turn it off while the feature is not
 * ready for their users.
 */
export const ENABLE_TOOL_CHANNEL_SETTINGS = true;

/**
 * Master switch for the (now removed) conversational agent-onboarding flow.
 *
 * Soft-disabled: kept in the codebase but permanently off. No client code
 * reads this anymore now that the agent-onboarding flow has been deleted.
 */
export const AGENT_ONBOARDING_ENABLED = false;

/**
 * Prefix on every issued API key.
 *
 * Users see and paste this string, so on a white-label distribution it is the
 * most directly visible piece of vendor branding there is — it travels in
 * support tickets, `.env` files and screenshots long after the UI has been
 * rebranded.
 *
 * It is also load-bearing: `validateApiKeyFormat` is what the OpenAPI auth
 * middleware uses to tell an API key from an OIDC JWT, so generation and
 * validation must read the SAME constant or every key stops authenticating.
 *
 * Changing it does NOT migrate keys already in the database — those stop
 * matching the format check and are rejected as malformed. A distribution that
 * has issued keys should accept both spellings for a period instead.
 */
export const API_KEY_PREFIX = 'sk-lh-';

export const OFFICIAL_PROVIDER_DISABLE_ERROR = 'The official provider cannot be disabled.';

export const isOfficialProvider = (id: string) =>
  ENABLE_BUSINESS_FEATURES && id === BRANDING_PROVIDER;
