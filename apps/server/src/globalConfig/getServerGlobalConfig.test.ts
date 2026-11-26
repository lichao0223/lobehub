import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface CapturedProviderConfig {
  enabled?: boolean;
  enabledKey?: string;
  fetchOnClient?: boolean;
  modelListKey?: string;
  withDeploymentName?: boolean;
}

const mocks = vi.hoisted(() => ({
  genServerAiProvidersConfig: vi.fn(
    async (_specificConfig: Record<string, CapturedProviderConfig>) => ({}),
  ),
}));

interface MockGlobalConfigOptions {
  agentGatewayProtocol?: number;
  agentGatewayUrl?: string;
  appUrl?: string;
  /** Administrator defaults returned by the CUST-011 resolver. */
  companyServiceDefaults?: {
    defaultAgent?: { config: { model: string; provider: string } };
    systemAgent?: Record<string, { model: string; provider: string }>;
    /** Tiers the resolver managed to fill; the client names those 「管理员默认」. */
    tiers?: Record<string, { model: string; provider: string }>;
  };
  enableAgentGateway?: boolean;
  enablePageCollab?: boolean;
  enableWorkspacePageCollab?: boolean;
  filesConfigEnv?: string;
  /**
   * CUST-011-C fork switch. Defaults to the shipped value (`true`) so the suite
   * exercises what a deployment actually gets; pass `false` to assert the
   * untouched upstream behaviour.
   */
  onlyCompanyProviderEnabled?: boolean;
  /** What `SYSTEM_AGENT` parses into. */
  systemAgentEnv?: Record<string, { model: string; provider: string }>;
  toolNameMaxLengthEnv?: string;
}

const mockGlobalConfigDependencies = (
  enableBusinessFeatures: boolean,
  options: MockGlobalConfigOptions = {},
) => {
  vi.doMock('@lobechat/business-const', () => ({
    DEFAULT_ONLY_COMPANY_PROVIDER_ENABLED: options.onlyCompanyProviderEnabled ?? true,
    ENABLE_BUSINESS_FEATURES: enableBusinessFeatures,
  }));

  vi.doMock('@/config/composio', () => ({
    composioEnv: {},
  }));

  vi.doMock('@/const/version', () => ({
    isDesktop: false,
  }));

  vi.doMock('@/envs/app', () => ({
    appEnv: {
      ...(options.agentGatewayProtocol === undefined
        ? {}
        : { AGENT_GATEWAY_PROTOCOL: options.agentGatewayProtocol }),
      ...(options.agentGatewayUrl ? { AGENT_GATEWAY_URL: options.agentGatewayUrl } : {}),
      ...(options.appUrl ? { APP_URL: options.appUrl } : {}),
      ...(options.enableAgentGateway === undefined
        ? {}
        : { ENABLE_AGENT_GATEWAY: options.enableAgentGateway }),
      AGENT_GATEWAY_SERVICE_TOKEN: 'token',
      ENABLE_PAGE_COLLAB: options.enablePageCollab,
      ENABLE_WORKSPACE_PAGE_COLLAB: options.enableWorkspacePageCollab,
    },
    getAppConfig: vi.fn(() => ({
      DEFAULT_AGENT_CONFIG: '',
    })),
  }));

  vi.doMock('@/envs/auth', () => ({
    authEnv: {
      AUTH_DISABLE_EMAIL_PASSWORD: false,
      AUTH_EMAIL_VERIFICATION: false,
      AUTH_ENABLE_MAGIC_LINK: false,
      AUTH_SSO_PROVIDERS: '',
    },
  }));

  vi.doMock('@/envs/file', () => ({
    fileEnv: {},
  }));

  vi.doMock('@/envs/image', () => ({
    imageEnv: {
      AI_IMAGE_DEFAULT_IMAGE_NUM: undefined,
    },
  }));

  vi.doMock('@/envs/knowledge', () => ({
    knowledgeEnv: {
      DEFAULT_FILES_CONFIG: options.filesConfigEnv,
    },
  }));

  vi.doMock('@/envs/langfuse', () => ({
    langfuseEnv: {
      ENABLE_LANGFUSE: false,
    },
  }));

  vi.doMock('@/envs/tools', () => ({
    toolsEnv: { TOOL_NAME_MAX_LENGTH: options.toolNameMaxLengthEnv },
  }));

  vi.doMock('@/libs/better-auth/utils/server', () => ({
    parseSSOProviders: vi.fn(() => []),
  }));

  vi.doMock('@/business/server/adminConsole/serviceDefaults', () => ({
    getCompanyServiceDefaults: vi.fn(async () => ({
      systemAgent: {},
      tiers: {},
      ...options.companyServiceDefaults,
    })),
  }));

  // The catalog merge owns its own DB read; this suite tests the config shape,
  // not the Tellhow console, so it stays out of the database entirely.
  vi.doMock('@/business/server/companyProvider', () => ({
    COMPANY_PROVIDER_ID: 'tellhow',
    withCompanyProviderCatalog: vi.fn(async (configs: Record<string, unknown>) => configs),
  }));

  vi.doMock('@/server/globalConfig/parseSystemAgent', () => ({
    parseSystemAgent: vi.fn(() => options.systemAgentEnv),
  }));

  vi.doMock('@/utils/object', () => ({
    cleanObject: vi.fn((object) => object),
  }));

  vi.doMock('./genServerAiProviderConfig', () => ({
    genServerAiProvidersConfig: mocks.genServerAiProvidersConfig,
  }));

  vi.doMock('./parseDefaultAgent', () => ({
    parseAgentConfig: vi.fn(() => ({})),
  }));

  vi.doMock('./parseFilesConfig', () => ({
    parseFilesConfig: vi.fn((envString?: string) => {
      if (envString === 'invalid') throw new Error('Invalid environment variable format.');
      return envString ? { embeddingModel: { model: envString, provider: 'ollama' } } : {};
    }),
  }));

  vi.doMock('./parseMemoryExtractionConfig', () => ({
    getPublicMemoryExtractionConfig: vi.fn(() => ({})),
  }));
};

const loadCapturedProviderConfig = async (
  enableBusinessFeatures: boolean,
  options?: MockGlobalConfigOptions,
) => {
  vi.resetModules();
  mocks.genServerAiProvidersConfig.mockClear();
  mockGlobalConfigDependencies(enableBusinessFeatures, options);

  const { getServerGlobalConfig } = await import('./index');
  await getServerGlobalConfig();

  return mocks.genServerAiProvidersConfig.mock.calls[0][0] as Record<
    string,
    CapturedProviderConfig
  >;
};

const loadServerConfig = async (
  enableBusinessFeatures: boolean,
  options?: MockGlobalConfigOptions,
) => {
  vi.resetModules();
  mocks.genServerAiProvidersConfig.mockClear();
  mockGlobalConfigDependencies(enableBusinessFeatures, options);

  const { getServerGlobalConfig } = await import('./index');
  return getServerGlobalConfig();
};

describe('getServerGlobalConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('should only enable LobeHub by default in business feature mode', async () => {
    const providerConfig = await loadCapturedProviderConfig(true);

    expect(providerConfig[ModelProvider.LobeHub].enabled).toBe(true);
    expect(providerConfig[ModelProvider.Ollama].fetchOnClient).toBe(true);

    for (const provider of Object.values(ModelProvider)) {
      if (provider === ModelProvider.LobeHub) continue;

      expect(providerConfig[provider].enabled).toBe(false);
    }
  });

  it('should only enable Tellhow by default for a user who has not chosen (CUST-011-C)', async () => {
    const providerConfig = await loadCapturedProviderConfig(false);

    // The enterprise built-in provider is the one exception; the admin console
    // still overwrites it in `withCompanyProviderCatalog()` when it is closed.
    expect(providerConfig.tellhow.enabled).toBe(true);
    expect(providerConfig.tellhow.fetchOnClient).toBeUndefined();

    for (const provider of Object.values(ModelProvider)) {
      if (provider === ModelProvider.Tellhow) continue;

      expect(providerConfig[provider].enabled).toBe(false);
    }

    // Provider-specific metadata survives the override: it is merged, not
    // replaced. `fetchOnClient` is independent from the default-enabled flag.
    expect(providerConfig[ModelProvider.Ollama].fetchOnClient).toBe(true);
  });

  it('should keep upstream defaults when the CUST-011-C switch is off', async () => {
    const providerConfig = await loadCapturedProviderConfig(false, {
      onlyCompanyProviderEnabled: false,
    });

    expect(providerConfig[ModelProvider.LobeHub]).toBeUndefined();
    expect(providerConfig[ModelProvider.OpenAI]).toBeUndefined();
    expect(providerConfig[ModelProvider.DeepSeek].enabled).toBe(true);
  });

  it('should enable gateway mode for business builds', async () => {
    await expect(loadServerConfig(true)).resolves.toMatchObject({
      enableGatewayMode: true,
    });
  });

  it('should enable gateway mode for self-hosted builds only when explicitly enabled with a gateway url', async () => {
    await expect(
      loadServerConfig(false, {
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: true,
      }),
    ).resolves.toMatchObject({
      agentGatewayUrl: 'https://gateway.test.com',
      enableGatewayMode: true,
    });

    await expect(
      loadServerConfig(false, {
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: false,
      }),
    ).resolves.toMatchObject({
      agentGatewayUrl: 'https://gateway.test.com',
      enableGatewayMode: false,
    });

    await expect(loadServerConfig(false, { enableAgentGateway: true })).resolves.toMatchObject({
      enableGatewayMode: false,
    });
  });

  it('should tell clients which page collaboration flag is on', async () => {
    const gateway = { agentGatewayUrl: 'https://gateway.test.com' };

    await expect(
      loadServerConfig(true, { ...gateway, enableWorkspacePageCollab: true }),
    ).resolves.toMatchObject({ enablePageCollab: false, enableWorkspacePageCollab: true });
    await expect(
      loadServerConfig(true, { ...gateway, enablePageCollab: true }),
    ).resolves.toMatchObject({ enablePageCollab: true, enableWorkspacePageCollab: false });
  });

  it('should declare gateway protocol 2 only where the v2 socket exists', async () => {
    // The business gateway serves `/v2/ws`; `lobehub/lobehub-gateway`, which is
    // what a self-hosted deployment runs, serves only `/ws`.
    await expect(loadServerConfig(true)).resolves.toMatchObject({ agentGatewayProtocol: 2 });
    await expect(
      loadServerConfig(false, {
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: true,
      }),
    ).resolves.toMatchObject({ agentGatewayProtocol: 1 });
  });

  it('should let AGENT_GATEWAY_PROTOCOL correct either guess', async () => {
    await expect(
      loadServerConfig(false, {
        agentGatewayProtocol: 2,
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: true,
      }),
    ).resolves.toMatchObject({ agentGatewayProtocol: 2 });

    // An on-prem business deployment sitting in front of a v1 gateway.
    await expect(loadServerConfig(true, { agentGatewayProtocol: 1 })).resolves.toMatchObject({
      agentGatewayProtocol: 1,
    });
  });

  // The client-driven chat path builds tool names in the browser, so `0`
  // (tool-name compression off) only takes effect if the server ships the value
  // with the global config.
  it('should expose TOOL_NAME_MAX_LENGTH to the client, including 0', async () => {
    await expect(loadServerConfig(false, { toolNameMaxLengthEnv: '0' })).resolves.toMatchObject({
      toolNameMaxLength: 0,
    });

    await expect(loadServerConfig(false, { toolNameMaxLengthEnv: '30' })).resolves.toMatchObject({
      toolNameMaxLength: 30,
    });

    await expect(loadServerConfig(false)).resolves.toMatchObject({
      toolNameMaxLength: undefined,
    });
  });

  // The value shipped to the client must be parsed exactly like the resolver
  // parses `process.env` on the server — same env value, same tool names on both
  // sides — and a typo must never take the whole global config down.
  it('should parse TOOL_NAME_MAX_LENGTH like the resolver, falling back instead of throwing', async () => {
    const cases: [string, number | undefined][] = [
      ['64', 64],
      ['1e2', 1], // parseInt semantics, not Number()
      ['2048', 2048], // no upper bound
      [' ', undefined], // not `0`
      ['-5', undefined],
      ['abc', undefined],
      ['', undefined],
    ];

    for (const [raw, expected] of cases) {
      await expect(loadServerConfig(false, { toolNameMaxLengthEnv: raw })).resolves.toMatchObject({
        toolNameMaxLength: expected,
      });
    }
  });

  it('should expose DEVICE_GATEWAY_PUBLIC_URL without a device gateway service token', async () => {
    vi.stubEnv('DEVICE_GATEWAY_PUBLIC_URL', 'https://device-gateway.example.com');
    vi.stubEnv('DEVICE_GATEWAY_SERVICE_TOKEN', undefined);
    vi.stubEnv('DEVICE_GATEWAY_URL', undefined);

    await expect(loadServerConfig(false)).resolves.toHaveProperty(
      'deviceGatewayUrl',
      'https://device-gateway.example.com',
    );
  });

  it('should expose the OIDC issuer derived from APP_URL, as the provider does', async () => {
    await expect(
      loadServerConfig(false, { appUrl: 'https://chat.example.com/' }),
    ).resolves.toHaveProperty('oidcIssuer', 'https://chat.example.com/oidc');
  });

  it('reports internal device gateway configuration independently of its public URL', async () => {
    vi.stubEnv('DEVICE_GATEWAY_URL', undefined);
    vi.stubEnv('DEVICE_GATEWAY_PUBLIC_URL', 'https://public-gateway.example.com');
    await expect(loadServerConfig(false)).resolves.toHaveProperty('deviceGatewayConfigured', false);

    vi.stubEnv('DEVICE_GATEWAY_URL', 'https://internal-gateway.example.com');
    vi.stubEnv('DEVICE_GATEWAY_PUBLIC_URL', undefined);
    const config = await loadServerConfig(false);
    expect(config.deviceGatewayConfigured).toBe(true);
    expect(config.deviceGatewayUrl).toBeUndefined();
  });

  it('should show the DEFAULT_FILES_CONFIG embedding model as the file embedding default', async () => {
    const config = await loadServerConfig(false, { filesConfigEnv: 'bge-m3' });

    expect(config.systemAgent?.fileEmbedding).toEqual({ model: 'bge-m3', provider: 'ollama' });
  });

  it('should not fail the client config on an invalid DEFAULT_FILES_CONFIG', async () => {
    const config = await loadServerConfig(false, { filesConfigEnv: 'invalid' });

    expect(config.systemAgent?.fileEmbedding).toBeUndefined();
  });

  // CUST-011 §7.1: administrator defaults > SYSTEM_AGENT / DEFAULT_AGENT_CONFIG
  // > code default, per slot. A tier the administrator left empty keeps the env.
  it('should put administrator model defaults above SYSTEM_AGENT env', async () => {
    const config = await loadServerConfig(false, {
      companyServiceDefaults: {
        defaultAgent: { config: { model: 'tellhow-chat', provider: 'tellhow' } },
        systemAgent: { agentMeta: { model: 'tellhow-chat', provider: 'tellhow' } },
        tiers: { main: { model: 'tellhow-chat', provider: 'tellhow' } },
      },
      systemAgentEnv: {
        agentMeta: { model: 'env-main', provider: 'env-provider' },
        translation: { model: 'env-flash', provider: 'env-provider' },
      },
    });

    expect(config.systemAgent).toMatchObject({
      // The administrator wins where both layers have a value.
      agentMeta: { model: 'tellhow-chat', provider: 'tellhow' },
      // An unset administrator tier still follows the deployment env.
      translation: { model: 'env-flash', provider: 'env-provider' },
    });
    expect(config.defaultAgent).toEqual({
      config: { model: 'tellhow-chat', provider: 'tellhow' },
    });
    // Only the tier the administrator filled is reported back to the client.
    expect(config.companyDefaultTiers).toEqual(['main']);
  });

  it('should keep the deployment env when the administrator configured nothing', async () => {
    const config = await loadServerConfig(false, {
      systemAgentEnv: { agentMeta: { model: 'env-main', provider: 'env-provider' } },
    });

    expect(config.systemAgent?.agentMeta).toEqual({
      model: 'env-main',
      provider: 'env-provider',
    });
    // No administrator tier: the personal page keeps saying 「系统推荐」.
    expect(config.companyDefaultTiers).toEqual([]);
  });

  it('should omit the OIDC issuer when APP_URL is not configured', async () => {
    await expect(loadServerConfig(false)).resolves.not.toHaveProperty('oidcIssuer');
  });

  it('should only advertise Agent Mail when it has a receive path', async () => {
    vi.stubEnv('LINQ_API_KEY', undefined);
    vi.stubEnv('AGENT_MAIL_API_KEY', 'am_test');
    vi.stubEnv('AGENT_MAIL_WEBHOOK_URL', undefined);
    vi.stubEnv('AGENT_MAIL_WEBHOOK_SECRET', undefined);

    // A mailbox that can be opened but never receives is not an offer.
    await expect(loadServerConfig(false)).resolves.toHaveProperty('agentIdentityProviders', []);

    // The shared signing secret is enough: deliveries are verified against it
    // when the account carries no webhook of its own.
    vi.stubEnv('AGENT_MAIL_WEBHOOK_SECRET', 'whsec_mail');
    await expect(loadServerConfig(false)).resolves.toHaveProperty('agentIdentityProviders', [
      'agent-mail',
    ]);
  });

  it('should advertise Agent Mail when provisioning registers its own webhook', async () => {
    vi.stubEnv('LINQ_API_KEY', undefined);
    vi.stubEnv('AGENT_MAIL_API_KEY', 'am_test');
    vi.stubEnv('AGENT_MAIL_WEBHOOK_SECRET', undefined);
    vi.stubEnv('AGENT_MAIL_WEBHOOK_URL', 'https://chat.example.com/accounts/webhooks/agent-mail');

    await expect(loadServerConfig(false)).resolves.toHaveProperty('agentIdentityProviders', [
      'agent-mail',
    ]);
  });
});
