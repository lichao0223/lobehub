# 管理员控制台（CUST-008）设计方案

> 状态：原型 / 设计评审阶段，尚未改产品代码。
> 目标：为 SSO 接入后的企业部署提供最小侵入的用户与默认配置管理能力，并且能低成本跟随上游合并。

## 1. 要解决的问题

当前部署通过统一认证平台 SSO 自动建用户（CUST-007）。新用户第一次进入后：

- 「实验室」里的功能开关全部取代码默认值（`DEFAULT_PREFERENCE.lab`），管理员无法按部署 / 按人控制；
- 默认模型、默认助手参数、服务模型只能靠环境变量（`DEFAULT_AGENT_CONFIG`、`SYSTEM_AGENT`）全局控制，不能按用户设置；
- 没有地方查看「这个用户现在到底是什么配置」，也没有地方限制「这个用户不许改模型 / Provider」。

需要的是一个**管理员入口**，能：

1. 查看所有用户及其当前生效配置；
2. 配置「新用户默认值」：实验室开关、默认模型、默认助手参数；
3. 给指定用户设置策略：是否允许修改模型配置、是否允许改实验室开关、强制某些开关；
4. 把默认值应用到存量用户时可预览、可控（只补未设置项 / 强制覆盖）；
5. 保留禁用用户、调整管理员等基础账号操作。

## 2. 现状（代码事实）

| 能力             | 现状                                                                                                 | 位置                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 用户表           | 已有 `role` / `banned` / `ban_reason` / `ban_expires` 字段                                           | `packages/database/src/schemas/user.ts`                                                        |
| 认证             | 已启用 Better Auth `admin()` 插件，前端 auth client 已装 `adminClient()`                             | `src/libs/better-auth/define-config.ts:318`、`src/libs/better-auth/auth-client.ts`             |
| 用户创建         | Better Auth `databaseHooks.user.create.after` → `UserService.initUser`                               | `src/libs/better-auth/define-config.ts:251`                                                    |
| 实验室开关       | 存在 `users.preference.lab`，默认值来自 `DEFAULT_PREFERENCE`                                         | `packages/const/src/user.ts`、`src/store/user/slices/preference/selectors/labPrefer.ts`        |
| 服务端实验室判断 | 多处直接读 `users.preference.lab`                                                                    | 例：`apps/server/src/services/aiAgent/pipeline/runSettings.ts`                                 |
| 用户设置         | `user_settings` 按列存 jsonb；读取时客户端用 `DEFAULT_SETTINGS` 补齐                                 | `packages/database/src/models/user.ts`、`src/store/user/slices/settings/selectors/settings.ts` |
| 服务端全局默认   | `GlobalServerConfig` 已携带 `defaultAgent` / `systemAgent` / `image`，客户端会并入 `defaultSettings` | `apps/server/src/globalConfig/index.ts`、`src/store/user/slices/common/action.ts:80`           |
| 默认模型         | `languageModel` 控制 Provider / 模型可用范围；`defaultAgent.config.model/provider` 是新会话默认模型  | `packages/business/config/src/llm.ts`、`@lobechat/const`                                       |
| RBAC             | 已有全局角色概念 `super_admin` 与权限矩阵，但没有管理员控制台入口                                    | `packages/const/src/rbac.ts`、`packages/database/src/models/rbac.ts`                           |

关键结论：

- **不需要改认证体系**：`users.role = 'admin'` 与 Better Auth admin 插件可以直接复用，用户列表 / 禁用 / 改角色 / 模拟登录都有现成接口。
- **不要改运行时读配置的路径**：服务端 agent 运行直接读 `users.preference` 与 `user_settings`。只要把管理员默认值**物化**进这两处，运行时零改动。
- **实验室默认值不能只放客户端**：服务端 `runSettings` 等路径也读 `users.preference.lab`，必须在服务端可见。

## 3. 方案总览

采用「**默认模板物化 + 策略层拦截**」，而不是在读取链路上做动态 overlay。

```
管理员控制台
  ├─ 部署默认模板 (admin_console_settings.defaults)
  │     ├─ settings 补丁：general / languageModel / systemAgent / defaultAgent / memory / tool / notification / hotkey / image / tts
  │     ├─ preference 补丁：lab / 字体 / 话题列表 / GitHub 自动化
  │     ├─ fieldPolicies：每个真实设置路径是否允许用户修改
  │     └─ pagePolicies：allowModelConfig / allowLabs / allowServiceModel / allowMemory / allowToolChannels
  ├─ 用户策略 (admin_console_user_policies)
  │     ├─ pagePolicies 覆盖
  │     ├─ fieldPolicies 覆盖（只读 / 锁定）
  │     └─ 锁定值（强制写入用户数据）
  │
  ├─ 新用户：initUser 时把模板写入 users.preference + user_settings
  ├─ 存量用户：管理员点「应用默认值」，按用户批量写
  └─ 写入拦截：updateSettings / updatePreference 按真实路径检查策略
```

### 为什么物化而不是动态合并

| 方案                     | 优点                                                    | 缺点                                                                                                |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 动态 overlay（读时合并） | 改默认值立即对所有人生效                                | 要改 `getUserPreference`、`getUserState`、`getUserSettings`、运行时多处读取；性能和缓存语义都变复杂 |
| **物化（推荐）**         | 运行时零改动；用户值可直接看 / 可审计；上游读取链不用碰 | 改默认值后要显式「应用到存量用户」                                                                  |

企业部署更看重可解释性：管理员看到「这个用户当前值是什么」，就是数据库里的值。默认模板变更用「应用」动作显式传播，避免某天改一个开关影响所有在跑的任务。

### 3.1 真实设置项矩阵

原型和实现都按当前代码里的真实设置页组织，不引入自定义字段。每个字段标注一种「可配置能力」：

| 能力         | 含义                                                       | 处理方式                                  |
| ------------ | ---------------------------------------------------------- | ----------------------------------------- |
| `server`     | 服务端持久化，可设默认值、可锁                             | 写入 `user_settings` / `users.preference` |
| `device`     | 设备本地（主题、语言、诊断、更新通道）                     | 不下发，仅在原型里展示为「设备本地」      |
| `private`    | 用户私有（API Key、自定义 Provider、人工干预白名单）       | 不下发，管理员不可见                      |
| `data`       | 用户资源 / 数据（设备、环境、技能、标签、连接器、API Key） | 不提供默认值                              |
| `serverOnly` | 服务端环境变量配置（S3、文件向量化、Provider 凭据）        | 不下发，不入模板                          |
| `readonly`   | 只读信息（关于、统计）                                     | 不提供默认值                              |

按真实设置页的分组（与 `useCategory.tsx` 一致）：

| 分组         | 页面                   | 可配置内容                                                                 | 主要路径                                                                 |
| ------------ | ---------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 账号         | 外观                   | 动画、密度、右键菜单、主题色、字号、字体抗锯齿、聊天外观、话题列表         | `general.*`、`preference.fontFamily`、`preference.topic*`                |
| 账号         | 快捷键                 | 可编辑热键默认值                                                           | `hotkey.<id>`                                                            |
| 账号         | 数据统计               | 只读                                                                       | —                                                                        |
| 智能体       | AI 服务商              | Provider 启停、模型白名单、是否允许用户改模型 / 填 Key / 加自定义 Provider | `languageModel.<provider>.*`、`keyVaults.*`（private）、`policy.*`       |
| 智能体       | 服务模型               | 4 个层级模型 + 17 个高级任务槽位                                           | `systemAgent.tiers.*`、`systemAgent.<slot>`                              |
| 智能体       | 技能                   | 用户数据，不提供默认值                                                     | —                                                                        |
| 智能体       | 工具                   | 搜索 / 抓取渠道默认优先级                                                  | `tool.searchProviders`、`tool.crawlerImpls`                              |
| 智能体       | 记忆设置               | 启用、强度                                                                 | `memory.enabled`、`memory.effort`                                        |
| 智能体       | 标签                   | 用户数据                                                                   | —                                                                        |
| 连接         | 集成                   | GitHub 自动化开关                                                          | `preference.integration.github.*`                                        |
| 连接         | 连接器                 | 用户数据                                                                   | —                                                                        |
| 运行资源     | 设备 / 订阅账号 / 环境 | 用户资源                                                                   | —                                                                        |
| 运行资源     | 凭证管理               | 用户私有                                                                   | —                                                                        |
| 系统与开发者 | 存储                   | 服务端配置                                                                 | —                                                                        |
| 系统与开发者 | 回收站 / API Key       | 用户数据                                                                   | —                                                                        |
| 系统与开发者 | 高级                   | 开发者模式、网关模式；诊断 / 更新通道为设备本地                            | `general.isDevMode`、`defaultAgent.config.chatConfig.disableGatewayMode` |
| 系统与开发者 | 实验室                 | 18 个真实实验开关                                                          | `preference.lab.*`                                                       |
| 系统与开发者 | 关于                   | 只读                                                                       | —                                                                        |

**默认值来源**（实现时直接引用，不手写副本）：

- `DEFAULT_SETTINGS`（`packages/config/src/index.ts`）→ `general`、`languageModel`、`systemAgent`、`defaultAgent`、`memory`、`tool`、`notification`、`hotkey`、`image`、`tts`
- `DEFAULT_PREFERENCE`（`packages/const/src/user.ts`）→ `lab`、话题列表默认
- `DEFAULT_AGENT_CONFIG`（`packages/const/src/settings/agent.ts`）→ 默认模型 `deepseek-v4-flash` / `deepseek`、温度等
- `DEFAULT_LLM_CONFIG`（`packages/business/config/src/llm.ts`）→ 默认启用 DeepSeek / OpenAI / Anthropic / Google
- `DEFAULT_SYSTEM_AGENT_CONFIG`（`packages/const/src/settings/systemAgent.ts`）→ 主模型 `deepseek-v4-flash`、Flash `gpt-5.6-luna`、验收 `glm-5.3-flash`
- `DEFAULT_MEMORY_SETTINGS` → 开启、强度 `medium`
- `LAB_FEATURES`（`src/features/Settings/labs/features.ts`）→ 实验室 18 项及 alpha/beta、商业版 / 桌面端标记

客户端渲染用的字段清单必须来自同一份 `packages/types/src/adminConsole/settingsSchema.ts`，避免原型、后端、前端三处各写一份。

**默认值解析顺序**：管理员模板 > 服务端环境变量（`DEFAULT_AGENT_CONFIG` / `SYSTEM_AGENT` / `DEFAULT_FILES_CONFIG` 等）> 代码默认常量。模板里只保存管理员显式改过的路径；未出现的路径继续走环境变量或代码默认，避免模板把部署已有配置 “拍平”。

## 4. 数据模型

新增两张 Fork 自有表，迁移放在 Fork 保留的 `9000+` 编号区间。

### 4.1 `admin_console_settings`（单例）

| 字段         | 类型            | 说明                             |
| ------------ | --------------- | -------------------------------- |
| `id`         | text PK         | 固定 `global`                    |
| `defaults`   | jsonb           | 部署默认模板                     |
| `updated_at` | timestamptz     |                                  |
| `updated_by` | text → users.id | 最后修改人，`on delete set null` |

`defaults` 形状（直接对应真实 `UserSettings` / `UserPreference`，只保留可下发字段）：

```ts
type DeployableSettings = Pick<
  UserSettings,
  | 'defaultAgent'
  | 'general'
  | 'hotkey'
  | 'image'
  | 'languageModel'
  | 'memory'
  | 'notification'
  | 'systemAgent'
  | 'tool'
  | 'tts'
>; // 明确排除 keyVaults / market

type DeployablePreference = Pick<
  UserPreference,
  | 'fontFamily'
  | 'terminalFontFamily'
  | 'integration'
  | 'lab'
  | 'projectTopicGroupMode'
  | 'topicGroupMode'
  | 'topicIncludeCompleted'
  | 'topicSortBy'
  | 'useCmdEnterToSend'
>;

interface AdminDefaults {
  version: 2;
  settings: PartialDeep<DeployableSettings>;
  preference: PartialDeep<DeployablePreference>;
  /** 真实路径 → 是否允许用户修改；未出现的路径按 true */
  fieldPolicies: Record<string, { editable: boolean }>;
  pagePolicies: {
    allowModelConfig: boolean; // 默认 true
    allowLabs: boolean; // 默认 true
    allowServiceModel: boolean; // 默认 true
    allowMemory: boolean; // 默认 true
    allowToolChannels: boolean; // 默认 true
  };
}
```

> `settings` 不是一份自定义 schema，而是 `UserSettings` 的稀疏补丁。新增上游设置字段时，只需在 `settingsSchema.ts` 里登记路径与能力，不需要改表结构。

### 4.2 `admin_console_user_policies`（按用户）

| 字段         | 类型               | 说明                |
| ------------ | ------------------ | ------------------- |
| `user_id`    | text PK → users.id | `on delete cascade` |
| `policy`     | jsonb              | 用户策略            |
| `updated_at` | timestamptz        |                     |
| `updated_by` | text → users.id    |                     |

```ts
interface AdminUserPolicy {
  /** 覆盖部署默认的页面级权限 */
  pagePolicies?: Partial<AdminDefaults['pagePolicies']>;
  /**
   * 按真实路径覆盖：
   * - editable: false → 用户端只读，但保留用户当前值
   * - locked: true → 强制使用 value（不填则用模板默认值）并置灰
   */
  fieldPolicies?: Record<string, { editable?: boolean; locked?: boolean; value?: unknown }>;
}
```

> 不把策略塞进 `users.preference`：用户可以写 preference，策略必须是用户不可写的独立表。

### 4.3 是否需要审计表

v1 先用 `updated_at/updated_by` 记录最后修改。若需要完整审计，再加 `admin_console_audit`（动作、目标用户、前后值、操作者、时间），不影响主流程。企业合规场景建议 P2 补上。

## 5. 配置生效规则

### 5.1 新用户（SSO 首登）

`UserService.initUser` 末尾增加一次 Fork 自有调用（try/catch，失败不阻塞登录）：

```ts
await adminConsoleService.applyDefaultsToNewUser(user.id);
```

该调用在一个事务里：

1. 读 `admin_console_settings.defaults`；
2. `users.preference = merge(DEFAULT_PREFERENCE, defaults.preference)`，只写白名单内的 key；
3. `user_settings` 插入 / 更新 `defaults.settings`，只写白名单列（不含 `keyVaults` / `market`）；
4. 对 `fieldPolicies[path].locked === true` 的字段，写入强制值；
5. 若该用户在 `ADMIN_CONSOLE_BOOTSTRAP_USERNAMES` / `EMAILS` 中，写 `users.role = 'admin'`。

这样新 SSO 用户一进来就带着管理员设定的实验室开关、默认模型、服务模型和外观默认值，客户端与服务端读到的都是同一份值。

### 5.2 存量用户

管理员在「用户设置模板」页保存后，出现两个动作：

- **仅补齐未设置项（推荐）**：只对「该路径在用户数据中不存在」的用户写入，不覆盖用户自己改过的值；
- **强制覆盖**：对所有选中用户写入模板值。

只处理 `capability = server` 的字段；`device`、`private`、`data`、`serverOnly`、`readonly` 一律跳过。执行前先 dry-run，返回：

```
将影响 128 人：补齐 96 人，跳过 32 人（已自定义）
可下发 N 项（按 settingsSchema 统计）；设备本地、用户私有、用户数据、服务端配置项自动跳过。
```

v1 同步执行，单次上限 2000 人，按 200 人一批；超过上限转后台任务（复用现有 asyncTask / 队列），页面显示进度。企业用户量通常在这个量级以内。

### 5.3 锁定项

`fieldPolicies[path].locked`（模板级）与用户策略里的 `locked` 是「强制值」：

- 保存模板 / 策略时立即物化到 `user_settings` / `users.preference` 的真实路径；
- 之后 `updatePreference` / `updateSettings` 拒绝修改这些路径；
- 客户端把对应控件置灰并显示「由管理员设置」。

锁定不是动态 overlay，因此服务端 agent 运行读到的仍然是数据库里的强制值。

### 5.4 模型配置权限

`pagePolicies.allowModelConfig = false` 时：

- 服务端：`settingsRouter.updateSettings` 拒绝 `languageModel`、`keyVaults`、`defaultAgent.config.model/provider` 的写入；
- 客户端：隐藏「模型服务商」设置入口；默认模型选择器只读，并显示策略提示；
- 注意：这只限制「用户级模型 / Provider 配置」。会话内临时切换模型属于 Agent 配置，v1 不拦截；如果确实要完全锁死，P2 再拦 Agent 配置写入。

## 6. 管理员身份

复用 `users.role`：

- 管理员 = `users.role === 'admin'`；
- 首个管理员用环境变量引导：`ADMIN_CONSOLE_BOOTSTRAP_USERNAMES`（工号，逗号分隔）、`ADMIN_CONSOLE_BOOTSTRAP_EMAILS`；
- `initUser` 时命中即写 `role = 'admin'`；对已存在用户，首次访问 `/admin` 时 `admin.whoami` 做一次惰性提升；
- 后续在管理端「用户详情 → 设为管理员 / 取消管理员」调 Better Auth `setRole`。

不新增强制 RBAC 表，也不改 `super_admin` 语义。将来若要与平台 `roleCodes` 对齐，只需把 SSO `roleCodes` 映射到 `users.role`，控制台不用改。

## 7. 管理端界面

独立路由 `/admin`，不进入主应用侧边栏，避免污染普通用户界面。

### 7.1 页面结构

```
/admin
  ├─ 总览
  │    ├─ 用户数 / 近 7 天新增 / 近 7 天活跃 / 禁用数
  │    ├─ 当前部署默认值摘要（默认模型、启用 Provider、实验室开启数、模型权限）
  │    └─ 最近管理动作
  ├─ 用户
  │    ├─ 搜索（工号 / 姓名 / 邮箱）
  │    ├─ 筛选（全部 / 管理员 / 已禁用 / 已自定义）
  │    ├─ 列表：用户、工号、状态、实验室、默认模型、策略、最后活跃
  │    └─ 行 → 右侧详情抽屉
  │         ├─ 概览：账号、来源、角色、状态
  │         ├─ 用户设置：按真实设置页查看「当前值 / 模板默认 / 锁定」
  │         ├─ 权限：模型/实验室/服务模型/记忆/工具权限覆盖
  │         └─ 操作：应用模板、重置、禁用/启用、设/撤管理员
  └─ 用户设置模板
       ├─ 左侧导航与真实设置页一致：
       │    账号（外观 / 快捷键 / 数据统计）
       │    智能体（AI 服务商 / 服务模型 / 技能 / 工具 / 记忆设置 / 标签）
       │    连接（集成 / 连接器）
       │    运行资源（设备 / 订阅账号 / 环境 / 凭证管理）
       │    系统与开发者（存储 / 回收站 / 高级 / API Key / 实验室 / 关于）
       ├─ 右侧逐项配置：默认值 + 可下发能力 + 允许修改 + 锁定
       ├─ 页面级权限卡：允许改模型 / 实验室 / 服务模型 / 记忆 / 工具
       └─ 保存 + 应用到存量用户（dry-run 预览，自动跳过不可下发项）
```

### 7.2 原型

交互原型见 `prototypes/admin-console/index.html`，直接浏览器打开即可点击：

- 四个页面切换：总览 / 用户 / 用户设置模板 / 审计日志；
- 用户设置模板按真实设置页分组，逐项显示路径、默认值、可下发能力、允许修改、锁定；
- 数据 / 资源类页面（技能、标签、设备、环境、凭证、存储等）明确标注 “不提供默认值”，不会伪造字段；
- 用户列表搜索 / 筛选；
- 点用户行打开详情抽屉，切换「概览 / 用户设置 / 权限 / 操作」；用户设置里可切换真实设置页，查看「当前值 vs 模板默认」并锁定；
- 保存模板后打开「应用范围」确认框（仅补齐 / 强制覆盖 + 影响人数 + 自动跳过不可下发项）。

原型视觉基线直接复刻现有设置页，不自造一套后台风格：

- 外壳按 `src/features/Settings/Layout`：左侧 `NavPanel`（280px、`colorBgLayout`、36px `NavItem`）+ 44px 页头；
- 内容区 `MAX_WIDTH = 1024`、`paddingBlock '24px 128px'`、`paddingInline 24`；模板页字段行为三列 `minmax(0, 1fr) 200px 28px`（标签 / 控件 / 锁定）；
- 卡片复刻 `@lobehub/ui` 的 `Form variant="filled" itemsType="group"`：外层 `fill-quaternary` 12px 圆角承载，内层 `colorBgContainer` 卡片（`margin: 0 3px 3px`、1px `borderSecondary` + 浅色 4 层阴影 + 8px 圆角，深色无阴影 ——`bodyFilledLight` 只在浅色挂载）；
- 侧栏分组复刻 `Settings/Layout/Body`：`SearchBar variant="filled"` + `Accordion`（`gap 8`、inline 指示器、32px 分组标题、hover `fillTertiary`）；
- 颜色、圆角、阴影全部走 `--lobe-color-*` / `--lobe-radius*` / `--lobe-shadow-*` token，取值对齐 `@lobehub/ui` 的 `theme.css`（主色 `#222222`，深色反转为 `#eeeeee`），深色由 `data-theme="dark"` 驱动；
- 侧栏支持搜索过滤与分组折叠，用户详情抽屉宽 520px（对齐设置页二级面板尺度）。

## 8. 后端接口

新增 Fork 自有 lambda router：`adminConsoleRouter`，通过 `adminProcedure` 保护。

| 接口                                | 作用                                                                |
| ----------------------------------- | ------------------------------------------------------------------- |
| `adminConsole.whoami`               | 返回 `{ isAdmin, role, canBootstrap }`，并做首次管理员提升          |
| `adminConsole.listUsers`            | 分页 + 搜索；join `user_settings` / `users.preference` 返回列表摘要 |
| `adminConsole.getUser`              | 用户详情：账号、偏好、设置、策略、生效值                            |
| `adminConsole.getSettingSchema`     | 返回真实设置项矩阵：分组、页面、路径、能力、默认值、是否可编辑      |
| `adminConsole.updateUserPolicy`     | 保存用户策略，物化锁定项                                            |
| `adminConsole.clearUserPolicy`      | 清除用户策略，恢复继承                                              |
| `adminConsole.getDefaults`          | 读部署默认模板                                                      |
| `adminConsole.updateDefaults`       | 保存模板（不自动应用）                                              |
| `adminConsole.previewApplyDefaults` | dry-run：返回影响人数 / 跳过人数 / 样例                             |
| `adminConsole.applyDefaults`        | 按模式批量应用（仅补齐 / 强制）                                     |
| `adminConsole.resetUser`            | 将单个用户恢复为部署默认                                            |
| `adminConsole.listAudit`（P2）      | 管理动作审计                                                        |

账号类操作直接复用 Better Auth admin 插件（无需新后端）：

- `listUsers` / `getUser`（用于基础账号信息，可选）
- `banUser` / `unbanUser`
- `setRole`
- `impersonateUser`（可选，建议默认关闭）
- `revokeUserSessions`

> 自定义 `listUsers` 的理由：需要把 `user_settings` 与 `users.preference` 的摘要一起返回，避免列表 N+1 查询。

## 9. 对现有代码的侵入清单

原则：**能新增文件就不改共享文件；必须改的共享文件只加一个接点。**

### 9.1 新增文件（合并友好）

```
packages/types/src/adminConsole.ts                          # 共享类型
packages/types/src/adminConsole/settingsSchema.ts           # 真实设置项矩阵（唯一事实源）
packages/database/src/schemas/adminConsole.ts               # 两张表
packages/database/src/models/adminConsole.ts                # 读写模型
packages/database/migrations/9001_admin_console.sql         # Fork 保留编号
apps/server/src/services/adminConsole/{index,defaults,policy,users}.ts
apps/server/src/routers/lambda/adminConsole/{index,procedures,users,defaults}.ts
src/features/AdminConsole/**                                # 页面与组件
src/routes/admin/**                                         # 路由片段
src/services/adminConsole.ts                                # 前端 service
src/store/adminConsole/**                                   # 可选：列表/详情 store
packages/locales/src/default/adminConsole.ts                # 文案
ADMIN_CONSOLE_DESIGN.md
prototypes/admin-console/index.html
```

### 9.2 必须修改的共享文件（逐条可核对）

| 文件                                              | 改动                                               | 风险                     |
| ------------------------------------------------- | -------------------------------------------------- | ------------------------ |
| `packages/database/src/schemas/index.ts`          | 导出新 schema                                      | 极低，一行               |
| `packages/database/src/models/index.ts`           | 导出新 model                                       | 极低，一行               |
| `apps/server/src/routers/lambda/index.ts`         | 挂载 `adminConsoleRouter`                          | 极低，一行               |
| `apps/server/src/services/user/index.ts`          | `initUser` 末尾调用 `applyDefaultsToNewUser`       | 低，try/catch 包裹       |
| `apps/server/src/routers/lambda/user/settings.ts` | `updateSettings` / `updatePreference` 增加策略检查 | 中，需回归设置保存       |
| `src/libs/better-auth/auth-client.ts`             | 导出 `admin`（用于禁用 / 改角色）                  | 极低，一个词             |
| `src/spa/router/desktopRouter.shared.tsx`         | 注册 `/admin` 路由                                 | 低，按 `spa-routes` 规范 |
| `src/features/Settings/labs/index.tsx`            | 读取策略，锁定项置灰                               | 低，纯展示               |
| `src/features/Settings/provider/index.tsx`        | 策略禁止时隐藏 / 只读                              | 低，纯展示               |
| `CUSTOMIZATIONS.md`                               | 登记 CUST-008                                      | 文档                     |

合计共享改动约 **11 个文件、每处 1 行到 1 个小函数**。不触碰 `getUserSettings` / `getUserPreference` / `getUserState` 等运行时读取链。

### 9.3 刻意不做的改动

- 不改 `DEFAULT_PREFERENCE` 的全局默认（避免所有部署行为变化）；
- 不改 `DEFAULT_SETTINGS` / `DEFAULT_LLM_CONFIG`；
- 不改 `GlobalServerConfig` 结构；
- 不改 agent 运行时读取逻辑；
- 不引入新的认证 Provider 或中间件。

## 10. 分阶段实施

### P0 原型（本次）

- 设计文档 + 可点击 HTML 原型；
- 不改产品代码，先在评审中确认交互与边界。

### P1 可用闭环（建议 1 个 PR）

1. 迁移与模型：两张表 + model；
2. `adminConsoleRouter` + `adminProcedure` + 管理员引导；
3. 新用户默认值物化（`initUser` 接入）；
4. `packages/types/src/adminConsole/settingsSchema.ts`：真实设置项矩阵；
5. `/admin` 用户列表 + 用户设置模板（按真实设置页分组）；
6. 用户详情：当前值 / 模板默认 / 锁定；
7. 单测：矩阵路径有效性、默认值合并、策略拦截、首次管理员提升、批量应用 dry-run。

### P2 权限与体验

1. 模型配置服务端拦截 + 真实设置页置灰；
2. 实验室锁定项前端置灰；
3. 服务模型 / 记忆 / 工具渠道的页面级权限；
4. 批量应用后台任务化（超过 2000 人）；
5. 审计日志；
6. 数据 / 资源类页面的权限策略（是否允许添加设备、环境、API Key、自定义 MCP）。

### P3 与平台权限对齐

- 把 SSO `roleCodes` 映射到 `users.role`，实现平台侧授权；
- 可选：接入 RBAC 权限码（`system:admin`），替代固定 `role = 'admin'`。

## 11. 上游合并检查点

合并 `lobehub/lobehub` 后逐条检查：

1. `define-config.ts` 的 `admin()` 插件是否还在；若上游移除，控制台的基础账号接口要改成自研 RPC。
2. `databaseHooks.user.create.after` → `UserService.initUser` 调用是否还在；若签名变化，同步 `applyDefaultsToNewUser`。
3. `user_settings` 列结构是否变化（`languageModel` / `defaultAgent` / `systemAgent`）；默认值物化字段要跟着改。
4. `users.preference.lab` 的 flag 列表是否新增 / 重命名；`LabFlag` 类型与 `src/features/Settings/labs/features.ts` 对齐。
5. `settingsRouter.updateSettings` / `updatePreference` 是否被拆分或改签名；策略检查是唯一必须跟进的写入口。
6. `desktopRouter.shared.tsx` 的路由注册方式；按 `spa-routes` 技能要求，Web/Electron 共享路由只注册一次。
7. Better Auth 升级时复核 `adminClient()` 的方法名与返回结构（`listUsers`、`banUser`、`setRole`）。
8. 迁移编号：继续使用 `9000+` 保留区；不要占用上游编号。

## 12. 验收清单

产品行为：

- [ ] 未配置默认模板时，新用户行为与现在完全一致；
- [ ] 模板中的每个 `server` 路径都能在真实设置页找到对应控件，且默认值与 `DEFAULT_*` 常量一致；
- [ ] 管理员把「自进化」默认打开后，新 SSO 用户登录即看到开启；
- [ ] 管理员设置默认模型 `deepseek/deepseek-v4-flash` 后，新用户新会话使用该模型；
- [ ] 管理员把主模型改为 `deepseek/deepseek-v4-pro`、Flash 改为 `openai/gpt-5.6-luna` 后，服务模型页显示一致；
- [ ] 管理员禁止某用户修改模型配置后，该用户设置页无法改 Provider / 默认模型，服务端写入也被拒绝；
- [ ] 管理员锁定某实验室开关后，用户端开关置灰，服务端运行按强制值执行；
- [ ] 设备本地（主题、语言、诊断、更新通道）、用户私有（API Key、自定义 Provider）、数据类（设备、环境、技能）字段不会被写入；
- [ ] 「仅补齐未设置项」不覆盖用户已改的值；dry-run 人数与实际一致；
- [ ] 非管理员访问 `/admin` 与直接调用 RPC 都被拒绝；
- [ ] 禁用用户后无法再建立会话（沿用 SSO 现有 `banned` 检查）。

工程验证：

- [ ] `bun run check` 覆盖改动文件；
- [ ] 迁移在真实 PostgreSQL 上执行通过，重复执行幂等；
- [ ] 上游合并演练：按第 11 节逐条复查，记录到 `CUSTOMIZATIONS.md`。

## 13. 待确认的产品决策

1. **默认值传播**：默认模板变更默认「只影响新用户」，还是保存后自动「仅补齐存量用户」？当前设计是保存不自动应用，必须手动点应用（更可控）。
2. **模型限制范围**：v1 只限制 Provider / 默认模型设置，还是连会话内切换模型也禁止？后者需要拦 Agent 配置写入，侵入更大。
3. **管理员数量**：是否需要多个管理员与操作审计？v1 支持多管理员，审计放 P2。
4. **实验室开关白名单**：是否允许管理员把某个实验室开关从用户界面完全隐藏（而不只是锁定）？建议 P2 再评估。
5. **v1 是否包含快捷键与 GitHub 自动化**：这两组字段可下发，但快捷键依赖设备、GitHub 依赖集成是否启用；建议先只读展示，P1 后期再开放编辑。
6. **默认助手参数**：管理员是否需要配置 `defaultAgent` 的温度、`top_p`、历史条数等参数，还是 v1 只配置 `model/provider`？参数级配置会让模板更复杂，建议 v1 只做模型，P2 再扩展。
