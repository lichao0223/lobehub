import type { ConnectorCatalogItem } from '@lobechat/const';

import type { MessengerPlatformItem } from '@/store/messenger/projection';

import { marketplaceAppPath } from '../paths';

export const appCategories = [
  'chat',
  'documents',
  'projects',
  'developer',
  'productivity',
] as const;
type AppCategory = (typeof appCategories)[number];

export interface MarketplaceApp {
  category: AppCategory;
  channel?: MessengerPlatformItem;
  channelLinked: boolean;
  channelPending: boolean;
  id: string;
  integrationConnected: boolean;
  name: string;
  tool?: ConnectorCatalogItem;
  toolConnected: boolean;
}

const categoryByTool: Record<string, AppCategory> = {
  'airtable': 'documents',
  'clickup': 'projects',
  'confluence': 'documents',
  'dropbox': 'documents',
  'figma': 'projects',
  'github': 'developer',
  'google-docs': 'documents',
  'google-drive': 'documents',
  'google-sheets': 'documents',
  'jira': 'projects',
  'linear': 'projects',
  'notion': 'documents',
  'onedrive': 'documents',
  'posthog': 'developer',
  'slack': 'chat',
  'supabase': 'developer',
  'vercel': 'developer',
  'whatsapp': 'chat',
};

// Fork-only: TFS keeps its binding page in Settings. The Marketplace card is an
// entry point to it, not an install flow of its own.
export const TFS_APP_ID = 'tfs';
export const TFS_SETTINGS_PATH = '/settings/tfs';

export const hasAppConnection = (app: MarketplaceApp) =>
  app.channelLinked || app.toolConnected || app.integrationConnected;

// A channel needs its own setup screen, even when the same app also provides tools.
export const getInlineConnectTool = (app: MarketplaceApp, lobehubEnabled: boolean) => {
  if (app.channel || hasAppConnection(app)) return;
  if (app.tool?.type === 'lobehub' && !lobehubEnabled) return;
  return app.tool;
};

export const getAppHome = (app: MarketplaceApp) => {
  if (app.id === TFS_APP_ID) return TFS_SETTINGS_PATH;
  const path = marketplaceAppPath(app.id);
  return app.channel && app.toolConnected && !app.channelLinked ? `${path}?capability=tools` : path;
};

export const buildMarketplaceApps = ({
  channels,
  isToolConnected,
  integrationConnected,
  installedChannels,
  linkedChannels,
  tfsConnected = false,
  tools,
}: {
  channels: readonly MessengerPlatformItem[];
  isToolConnected: (tool: ConnectorCatalogItem) => boolean;
  integrationConnected: (id: string) => boolean;
  installedChannels: ReadonlySet<string>;
  linkedChannels: ReadonlySet<string>;
  /** Fork-only: whether this member already bound a personal TFS account. */
  tfsConnected?: boolean;
  tools: readonly ConnectorCatalogItem[];
}): MarketplaceApp[] => {
  const apps = new Map<string, MarketplaceApp>();
  for (const tool of tools) {
    const id = tool.type === 'lobehub' ? tool.provider.id : tool.serverType.identifier;
    const name = tool.type === 'lobehub' ? tool.provider.label : tool.serverType.label;
    apps.set(id, {
      category: categoryByTool[id] ?? 'productivity',
      channelLinked: false,
      channelPending: false,
      id,
      name,
      integrationConnected: integrationConnected(id),
      tool,
      toolConnected: isToolConnected(tool),
    });
  }

  for (const channel of channels) {
    const app = apps.get(channel.id);
    const linked = linkedChannels.has(channel.id);
    const installed = installedChannels.has(channel.id);
    apps.set(channel.id, {
      ...app,
      category: 'chat',
      channel,
      channelLinked: linked && (channel.id !== 'wechat' || installed),
      channelPending: installed && !linked,
      id: channel.id,
      name: channel.name,
      integrationConnected: false,
      toolConnected: app?.toolConnected ?? false,
    });
  }

  // Fork-only: the deployment-local TFS / Azure DevOps binding. It has no
  // connector catalog entry, so the card is added here instead of coming from
  // `tools`; opening it lands on the settings tab that manages the binding.
  apps.set(TFS_APP_ID, {
    category: 'developer',
    channelLinked: false,
    channelPending: false,
    id: TFS_APP_ID,
    integrationConnected: tfsConnected,
    name: 'TFS / Azure DevOps',
    toolConnected: false,
  });

  return [...apps.values()];
};
