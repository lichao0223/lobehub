// @vitest-environment node
import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCompanyServiceDefaults } from '@/business/server/adminConsole/serviceDefaults';
import { AgentModel } from '@/database/models/agent';
import { UserModel } from '@/database/models/user';
import { parseAgentConfig } from '@/server/globalConfig/parseDefaultAgent';
import type * as RedisModule from '@/server/modules/Redis';

import { AgentService } from './index';

vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: vi.fn(),
}));

vi.mock('@/business/agent-share', () => ({
  AGENT_SHARE_ALLOWED_PROVIDERS: ['lobehub'],
}));

vi.mock('@/business/server/adminConsole/serviceDefaults', () => ({
  getCompanyServiceDefaults: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { DEFAULT_AGENT_CONFIG: '' },
  getAppConfig: () => ({ DEFAULT_AGENT_CONFIG: '' }),
}));

vi.mock('@/server/globalConfig/parseDefaultAgent', () => ({
  parseAgentConfig: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(),
}));

vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: Object.assign(vi.fn(), { lockScopedAgentRow: vi.fn() }),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(),
}));

vi.mock('@/envs/redis', () => ({
  getRedisConfig: vi.fn().mockReturnValue({ enabled: false }),
}));

vi.mock('@/server/modules/Redis', async (importOriginal) => {
  const original = await importOriginal<typeof RedisModule>();
  return {
    ...original,
    initializeRedisWithPrefix: vi.fn(),
    isRedisEnabled: vi.fn().mockReturnValue(false),
  };
});

const mockDb = {} as any;
const mockUserId = 'test-user-id';

const administratorDefault = {
  defaultAgent: { config: { model: 'deepseek-flash-latest', provider: 'tellhow' } },
  systemAgent: {},
  tiers: { main: { model: 'deepseek-flash-latest', provider: 'tellhow' } },
};

const mockAgentConfigRead = (agent: Record<string, unknown>) => {
  (AgentModel as any).mockImplementation(function () {
    return { getAgentConfig: vi.fn().mockResolvedValue(agent) };
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  (UserModel as any).mockImplementation(function () {
    return {
      getUserSettings: vi.fn().mockResolvedValue({}),
      getUserSettingsDefaultAgentConfig: vi.fn().mockResolvedValue({}),
    };
  });
  (getCompanyServiceDefaults as any).mockResolvedValue({ systemAgent: {}, tiers: {} });
});

// CUST-011-F: the chat send path reads this merged config before the first
// message, so an inbox row persisted without a model must name the deployment's
// main model instead of the built-in provider.
describe('AgentService deployment default agent config', () => {
  it('resolves an agent without a model to the administrator default', async () => {
    mockAgentConfigRead({ id: 'agent-1', systemRole: 'Test' });
    (parseAgentConfig as any).mockReturnValue({ model: 'env-model', provider: 'env' });
    (getCompanyServiceDefaults as any).mockResolvedValue(administratorDefault);

    const result = await new AgentService(mockDb, mockUserId).getAgentConfig('agent-1');

    expect(result?.model).toBe('deepseek-flash-latest');
    expect(result?.provider).toBe('tellhow');
  });

  it("keeps the agent's own model over the administrator default", async () => {
    mockAgentConfigRead({ id: 'agent-1', model: 'qwen3.6-35b', provider: 'tellhow' });
    (parseAgentConfig as any).mockReturnValue({});
    (getCompanyServiceDefaults as any).mockResolvedValue(administratorDefault);

    const result = await new AgentService(mockDb, mockUserId).getAgentConfig('agent-1');

    expect(result?.model).toBe('qwen3.6-35b');
    expect(result?.provider).toBe('tellhow');
  });

  it("keeps the user's own default model over the administrator default", async () => {
    mockAgentConfigRead({ id: 'agent-1' });
    (parseAgentConfig as any).mockReturnValue({});
    (getCompanyServiceDefaults as any).mockResolvedValue(administratorDefault);
    (UserModel as any).mockImplementation(function () {
      return {
        getUserSettings: vi.fn().mockResolvedValue({}),
        getUserSettingsDefaultAgentConfig: vi
          .fn()
          .mockResolvedValue({ config: { model: 'qwen3.6-35b', provider: 'tellhow' } }),
      };
    });

    const result = await new AgentService(mockDb, mockUserId).getAgentConfig('agent-1');

    expect(result?.model).toBe('qwen3.6-35b');
  });

  it('falls back to the code default when the administrator set nothing', async () => {
    mockAgentConfigRead({ id: 'agent-1' });
    (parseAgentConfig as any).mockReturnValue({});

    const result = await new AgentService(mockDb, mockUserId).getAgentConfig('agent-1');

    expect(result?.model).toBe(DEFAULT_AGENT_CONFIG.model);
    expect(result?.provider).toBe(DEFAULT_AGENT_CONFIG.provider);
  });
});
