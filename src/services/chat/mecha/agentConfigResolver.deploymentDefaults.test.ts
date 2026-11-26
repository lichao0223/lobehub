import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as agentStore from '@/store/agent';
import * as agentSelectors from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { initialSettingsState } from '@/store/user/slices/settings/initialState';

import { resolveAgentConfig } from './agentConfigResolver';

vi.hoisted(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

/**
 * CUST-011-F: a new conversation must follow the deployment default chain —
 * user pick > administrator main model > `DEFAULT_AGENT_CONFIG` — instead of
 * sending its first message to the built-in provider.
 */
describe('resolveAgentConfig deployment default model', () => {
  const mockAgentConfig = {
    model: 'gpt-4',
    plugins: ['plugin-a'],
    systemRole: 'You are a helpful assistant',
  };
  const adminDefaults = {
    defaultAgent: { config: { model: 'deepseek-flash-latest', provider: 'tellhow' } },
  } as any;

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(agentStore, 'getAgentStoreState').mockReturnValue({ someState: true } as any);
    vi.spyOn(agentSelectors.agentByIdSelectors, 'getAgentById').mockReturnValue(
      () => undefined as any,
    );
    vi.spyOn(agentSelectors.agentSelectors, 'getAgentSlugById').mockReturnValue(() => undefined);
    vi.spyOn(agentSelectors.agentSelectors, 'getAgentConfigById').mockReturnValue(
      () => ({ ...mockAgentConfig }) as any,
    );
    vi.spyOn(agentSelectors.chatConfigByIdSelectors, 'getChatConfigById').mockReturnValue(
      () => ({}) as any,
    );
    useUserStore.setState({ user: undefined, workspaceUserPreference: {} });
  });

  afterEach(() => {
    useUserStore.setState({
      defaultSettings: initialSettingsState.defaultSettings,
      settings: {},
    });
  });

  const agentWithoutModel = () =>
    vi
      .spyOn(agentSelectors.agentSelectors, 'getAgentConfigById')
      .mockReturnValue(
        () => ({ ...mockAgentConfig, model: undefined, provider: undefined }) as any,
      );

  it('falls back to the administrator main model when the agent has no model', () => {
    useUserStore.setState({ defaultSettings: adminDefaults, settings: {} });
    agentWithoutModel();

    const result = resolveAgentConfig({ agentId: 'test-agent' });

    expect(result.agentConfig.model).toBe('deepseek-flash-latest');
    expect(result.agentConfig.provider).toBe('tellhow');
  });

  it('falls back to the administrator main model when the agent config is not hydrated', () => {
    useUserStore.setState({ defaultSettings: adminDefaults, settings: {} });
    vi.spyOn(agentSelectors.agentSelectors, 'getAgentConfigById').mockReturnValue(
      () => undefined as any,
    );

    const result = resolveAgentConfig({ agentId: 'test-agent' });

    expect(result.agentConfig.model).toBe('deepseek-flash-latest');
    expect(result.agentConfig.provider).toBe('tellhow');
  });

  it("keeps the user's own default model over the administrator default", () => {
    useUserStore.setState({
      defaultSettings: adminDefaults,
      settings: { defaultAgent: { config: { model: 'qwen3.6-35b', provider: 'tellhow' } } },
    });
    agentWithoutModel();

    const result = resolveAgentConfig({ agentId: 'test-agent' });

    expect(result.agentConfig.model).toBe('qwen3.6-35b');
  });

  it("keeps the agent's own model over every default", () => {
    useUserStore.setState({ defaultSettings: adminDefaults, settings: {} });

    const result = resolveAgentConfig({ agentId: 'test-agent' });

    expect(result.agentConfig.model).toBe('gpt-4');
  });

  it('falls back to the code default when the administrator set nothing', () => {
    useUserStore.setState({
      defaultSettings: { defaultAgent: { config: {} } } as any,
      settings: {},
    });
    agentWithoutModel();

    const result = resolveAgentConfig({ agentId: 'test-agent' });

    expect(result.agentConfig.model).toBe(DEFAULT_AGENT_CONFIG.model);
    expect(result.agentConfig.provider).toBe(DEFAULT_AGENT_CONFIG.provider);
  });
});
