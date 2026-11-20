# 管理员控制台（CUST-008）设计方案

> 状态：设计评审（第四版）。尚未改产品代码。
> 目标：为 SSO 接入后的企业部署提供「用户与审计」「AI 服务统一托管」「设备池统一分配」三块能力，并且能低成本跟随上游合并。

第三版在第二版基础上做了一次**范围再收窄 + 侵入面重估**：

| 第二版                                        | 第三版                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 四块并列（用户 / 审计 / AI / 设备）           | 三块，且**用户与审计先行、可独立上线**；AI 与设备各自成阶段                                                    |
| 顺带提到外观 / 快捷键 / 数据统计              | 明确**连管理入口都不做**（§1.2 给了产品理由）                                                                  |
| AI 托管含菜单隐藏 + 写拒绝 + 传播             | 保留，但把写拒绝从「16 个 mutation 逐个改」压到「2 个 base procedure 各加 1 行」                               |
| 设备池落在自建 router + 改 device router 汇总 | 池接口挂到上游预留的 `businessDeviceRouter`，**device router 汇总文件零改动**                                  |
| 侵入清单按「新增 / 共享」粗列，路径有误       | 按「上游预留扩展槽 / 必须改」分类，逐文件标行数，`devices` 落在 `schemas/device.ts`（原文误写 `workspace.ts`） |

第四版**不改架构**，只落实本轮产品方确认的五条决定，并订正第三版的两处计数：

| 本轮确认                                              | 落点                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| 外观 / 快捷键不做，连入口都不留                       | §1.2 由「建议排除」升为「已确认排除」                           |
| 数据统计不做                                          | 同上；不占表、RPC、原型页位                                     |
| 先做用户管理 + 审计日志                               | §1.1、§10：P1 只交付两个页面，AI 与设备入口在 P1 不渲染         |
| 设备全局注册给管理员，再由管理员分配「全员 / 部分人」 | §6.1：管理员持有的池行 + 授权表；`devices.userId` 保持 NOT NULL |
| CLI 要能扩展                                          | §6.2：`lh device pool …` 挂在现有 `device` 命令组下             |

## 1. 范围

### 1.1 三块能力

| 能力                    | 用户可见结果                                                                                                                                          | 交付阶段           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **用户管理 + 审计日志** | `/admin/users` 列表、搜索、详情、禁用 / 启用、设 / 撤管理员、会话失效；每次写操作落一条审计                                                           | P1，**可单独上线** |
| **AI 服务统一托管**     | 管理员统一控制 Provider 默认值、可用模型、默认模型、服务模型（4 个层级）；非管理员**看不到**「AI 服务商」「服务模型」两个菜单，服务端同时拒绝其写配置 | P2                 |
| **设备池**              | 设备登记进管理员池，管理员分配给全员或指定人；被分配的人在设备列表 / 选择器里看到并可用；CLI 提供 `lh device pool` 子命令                             | P3                 |

三者互不依赖：P1 交付后即使不做 AI 与设备，也已经是一个可用的「企业账号后台」。因此 **P1 的 `/admin` 只渲染「用户管理」「审计日志」两个导航项**，AI 服务与设备在 P2 / P3 上线时才出现，不交付点了没反应的空页面。

### 1.2 明确不做

**管理入口层面（本轮产品方已确认不做，不再作为候选）**：

- 外观（主题、字号、语言）—— 纯个人偏好，管理员强制统一只会让用户困惑，且和「谁能用这套系统」无关；
- 快捷键 —— 个人输入习惯，且桌面 / 浏览器差异大，服务端无法可靠校验；
- 数据统计 —— 属于用量分析（`usage` / `dashboard` 已在上游产品里），不属于账号治理；企业要看出勤 / 配额应当另接 BI，不做半套统计页。

这三项不占 `/admin` 的路由、表、RPC 与原型页位。`user_settings` 里的外观与快捷键字段继续由用户自己控制，本方案不对其做任何默认值覆盖。

**设置托管层面**（延续第二版结论）：

- 实验室、记忆、工具渠道、通知、集成、GitHub 自动化的**默认值模板**；
- 全量设置字段矩阵（`settingsSchema.ts`）与 `fieldPolicies`；
- 「仅补齐 / 强制覆盖」双模式；
- `pagePolicies` 五项（模型 / 实验室 / 服务模型 / 记忆 / 工具）。

理由：这些字段要么是设备本地 / 用户私有，要么用户希望自己调；真正需要「统一」的只有 Provider 与模型的可用范围、服务模型层级，以及设备归属。

### 1.3 保留但降级

- 管理员身份仍用 `users.role = 'admin'` + `ADMIN_CONSOLE_BOOTSTRAP_*` 惰性提权；
- 存量用户批量应用只针对**三个托管字段**（`language_model` / `default_agent.config.model` / `system_agent` 的托管槽位），不再有通用模板应用。

### 1.4 本轮六个问题的结论

| 问题                                      | 结论                                     | 理由                                                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 外观 / 快捷键要做成管理项吗？             | 不做                                     | 纯个人偏好，强制统一只会让用户困惑，且与服务端权限无关                                                                                                                   |
| 数据统计要做吗？                          | 不做                                     | 上游 `usage` / `dashboard` 已覆盖用量分析，账号治理不需要半套统计                                                                                                        |
| AI 服务商的默认值和服务模型能统一控制吗？ | 能，两层分别管                           | 默认值走 `getServerGlobalConfig` 的默认值链；服务模型走 `user_settings.system_agent` 的托管槽位，保存即传播（§5）                                                        |
| 非管理员能看不到这两个菜单吗？            | 能，且服务端同时拒绝写入                 | 菜单只做体验：`showProvider` / `showServiceModel` 由 flag 与管理员策略合成；写入由两个 base procedure 拦（§5.5–5.6）                                                     |
| 设备能全局注册给管理员吗？                | 能，但保持 `devices.userId = 注册管理员` | 这个 `userId` 是 gateway 的寻址 principal（NOT NULL）。改成「无主」要动注册唯一键、gateway 寻址与全部派发路径；「管理员持有 + `pool` 标记 + 授权表」不改既有语义（§6.1） |
| CLI 能扩展吗？                            | 能，零风险                               | `registerDeviceCommand` 内部就是 `device.command(...)` 链，新增 `pool` 子命令组只在 `commands/device.ts` 加一行注册（§6.2）                                              |

## 2. 现状与关键发现

| 能力                | 现状                                                                                                                                                                        | 位置                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 认证                | Better Auth `admin()` 已启用，`adminClient()` 已装                                                                                                                          | `src/libs/better-auth/define-config.ts`、`auth-client.ts`                                                  |
| 用户创建            | `databaseHooks.user.create.after` → `UserService.initUser` → `initNewUserForBusiness`                                                                                       | `define-config.ts`、`apps/server/src/services/user/index.ts:30`                                            |
| 用户设置            | `user_settings` 按列存 jsonb：`language_model` / `default_agent` / `system_agent`                                                                                           | `packages/database/src/schemas/user.ts`                                                                    |
| 服务端全局配置      | `getServerGlobalConfig()` 输出 `GlobalServerConfig`，`aiProvider` / `defaultAgent` 在此组装                                                                                 | `apps/server/src/globalConfig/index.ts:184`                                                                |
| 配置下发            | `configRouter.getGlobalConfig` 是 `publicProcedure`，但带 `ctx.userId`，已调用 `getServerFeatureFlagsStateFromRuntimeConfig(ctx.userId)`；末尾 `...businessConfigEndpoints` | `apps/server/src/routers/lambda/config/index.ts`                                                           |
| 用户级 flag         | `RuntimeConfigProvider` 已有 Redis per-user override（`feature-flags-user-overrides`）                                                                                      | `apps/server/src/featureFlags/index.ts`                                                                    |
| 菜单开关            | `showProvider` 由 `provider_settings` flag 映射；**没有** `showServiceModel`                                                                                                | `packages/app-config/src/featureFlags/schema.ts:309`、`src/features/Settings/hooks/useCategory.tsx:83,167` |
| 设备表              | `devices`：`userId`（NOT NULL）+ 可选 `workspaceId` + `visibility`，两条部分唯一索引                                                                                        | **`packages/database/src/schemas/device.ts:18`**（第二版误写 workspace.ts）                                |
| 设备查询            | `DeviceModel.queryPersonal()` / `queryWorkspaceDevices()` / `querySharedWorkspaceDevices()`                                                                                 | `packages/database/src/models/device.ts`                                                                   |
| 设备可见性汇总      | `getScopedOnlineDevices(serverDB, userId, workspaceId?)`，**9 个文件 / 11 个调用点共享**                                                                                    | `apps/server/src/services/deviceGateway/scopedDevices.ts:48`                                               |
| 设备列表 RPC        | `device.listDevices` 自己并发查 personal/workspace/shared 三路 + 两路在线状态                                                                                               | `apps/server/src/routers/lambda/device/registry.ts:214`                                                    |
| 设备派发            | 所有 server runtime 都走 `executeAuthorizedDeviceToolCall`（5 个文件 / 7 个调用点：localSystem 1、skills 3、browser 1、auv 1、tfs 1）                                       | `apps/server/src/services/deviceGateway/authorizedToolCall.ts:23`                                          |
| 派发前校验          | `resolveDeviceDispatchAuthorizationFailure`：**无 `workspaceId` 时直接放行**（personal 无校验）                                                                             | `apps/server/src/services/deviceGateway/dispatchAuthorization.ts:28`                                       |
| 设备 router 汇总    | `mergeRouters(..., businessDeviceRouter)`，`businessDeviceRouter` 在 OSS 下是空 router                                                                                      | `apps/server/src/routers/lambda/device/index.ts`、`packages/business-server/src/lambda-routers/device.ts`  |
| 业务扩展槽（已有）  | `getHiddenBuiltinModelsForUser` / `getModelRedirects`、`initNewUserForBusiness`、`getDevDockAccess`                                                                         | `packages/business-server/src/{aiProvider,user,devDockAccess}.ts`                                          |
| 模型访问过滤        | `getUserScopedAiProviderRuntimeState` / `getUserScopedAiProviderModelList` 在仓库缓存之上叠加「按用户隐藏模型」，未解析到策略即 fail closed                                 | `apps/server/src/services/aiProviderAccess.ts`                                                             |
| 供应商 / 模型写入面 | `aiProvider` 6 个 mutation、`aiModel` 10 个 mutation，共用一个 base procedure                                                                                               | `apps/server/src/routers/lambda/{aiProvider,aiModel}.ts`                                                   |
| CLI 设备            | `lh device list / info / delete`，注册走 `trpc.device.register`                                                                                                             | `apps/cli/src/commands/device.ts`、`src/device/register.ts`                                                |

**六条关键结论**

1. **菜单显隐有现成管道，但必须改 `getGlobalConfig` 本身。** `businessConfigEndpoints` 只提供**新增** procedure（且被 spread 在最后，无法优雅覆写既有 `getGlobalConfig`），所以菜单合并只能在共享文件里加 4 行 + 一个 business 函数，照抄 `getDevDockAccess` 的现有写法。不新建 RPC、不新建 store。
2. **「统一控制」必须物化。** 服务端运行直接读 `user_settings` 三列与 `users.preference`；把管理员配置写进这三列，运行时零改动。动态 overlay 会波及 `getUserSettings` / `getUserPreference` / `getUserState` 与多个运行时读取点，不做。
3. **设备池可以不改归属语义。** `devices.userId` 是 gateway 的寻址 principal（NOT NULL），池设备仍由注册它的管理员持有，用户通过授权表获得可见与可用；新增的只是「查询合并」与「派发时把 principal 换成 owner」。
4. **设备池的写接口可以零改动挂载。** `deviceRouter` 已经 `mergeRouters(..., businessDeviceRouter)`，OSS 下 `businessDeviceRouter = router({})`。把 `device.adminPool.*` 写进业务层这个模块即可，**不需要**改 `device/index.ts`，也不需要新建 `routers/lambda/adminDevicePool/`。
5. **设备池的读接口只有两个接点。** 9 个文件 / 11 个调用点共享 `getScopedOnlineDevices`；UI 列表只多一处 `device.listDevices`。派发侧全部收敛在 `executeAuthorizedDeviceToolCall`。
6. **模型白名单有现成的 fail-closed 管道**，`AiInfraRepos` 与 8 个消费方都不用动。反过来，**写入面只需要两行**：`aiProviderProcedure` / `aiModelProcedure` 两个 base 各挂一个只看 `opts.type === 'mutation'` 的中间件。

## 3. 总体设计

```
/admin
 ├─ 用户管理   → Better Auth admin() + 列表摘要查询（P1）
 ├─ 审计日志   → admin_console_audit_logs（P1）
 │
 ├─ AI 服务    → admin_console_settings.ai（P2）
 │    ├─ Provider 默认值 / 可用模型   → getServerGlobalConfig 覆盖 + 隐藏模型集合
 │    ├─ 默认模型（新用户默认）        → user_settings.language_model / default_agent.config
 │    ├─ 服务模型（main / flash / embedding / verify 四层）→ user_settings.system_agent 托管槽位
 │    └─ 保存即全量传播，并刷新隐藏集合缓存
 │
 └─ 设备       → devices.pool='admin' + admin_console_device_grants（P3）
      ├─ CLI: lh device pool register / list / grant / revoke / owner / remove
      ├─ 用户侧：被授权才在设备列表与 ChatInput 选择器里出现
      └─ 派发：服务端把 principal 换成设备 owner，调用者不感知
```

写入约束共三处入口，全部在服务端：

1. `aiProvider` / `aiModel` 两个 router 的 mutation（加供应商、加模型、改 Key）→ `FORBIDDEN`；
2. `settingsRouter.updateSettings` 的 `languageModel` / `defaultAgent.config.model` → 只允许白名单内的模型；
3. `settingsRouter.updateSettings` 的 `system_agent` → 托管槽位被强制改写回管理员配置（其余槽位照常）。

菜单隐藏是体验，服务端约束才是边界。

## 4. 数据模型

新增两张 Fork 自有表 + `devices` 一列；迁移文件名用 `9000+` 保留区：`9001_admin_console.sql`。

### 4.1 `admin_console_settings`（单例）

| 字段         | 类型            | 说明                 |
| ------------ | --------------- | -------------------- |
| `id`         | text PK         | 固定 `global`        |
| `config`     | jsonb           | 见下                 |
| `updated_at` | timestamptz     |                      |
| `updated_by` | text → users.id | `on delete set null` |

```ts
interface AdminConsoleSettings {
  version: 1;
  /** 是否启用托管。false 时整套策略短路，行为与未安装本功能完全一致 */
  enabled: boolean;
  ai: {
    /** providerId → 是否启用 + 可用模型（models 缺省 = 该 provider 的全部内置模型） */
    providers: Record<string, { enabled: boolean; models?: string[] }>;
    /** 新用户默认模型，写入 defaultAgent.config 与 language_model */
    defaultModel?: { provider: string; model: string };
    /** 4 个层级，按 SERVICE_MODEL_TIER_SLOTS 展开写入 user_settings.system_agent */
    systemAgent?: PartialDeep<SystemAgentConfig>;
  };
  menu: {
    /** 非管理员隐藏「AI 服务商」，默认 true */
    hideProviderForNonAdmin: boolean;
    /** 非管理员隐藏「服务模型」，默认 true */
    hideServiceModelForNonAdmin: boolean;
  };
}
```

`ai` 里只保存管理员显式改过的键；未出现的键继续走环境变量与代码默认，避免模板把部署既有配置「拍平」。

### 4.2 `admin_console_audit_logs`

| 字段          | 类型            | 说明                                                           |
| ------------- | --------------- | -------------------------------------------------------------- |
| `id`          | uuid PK         |                                                                |
| `actor_id`    | text → users.id | `on delete set null`                                           |
| `actor_name`  | text            | 冗余快照，用户删除后仍可读                                     |
| `action`      | text            | `user.ban` / `ai.update` / `device.grant` …                    |
| `target_type` | text            | `user` / `settings` / `device`                                 |
| `target_id`   | text            | 目标 id                                                        |
| `detail`      | jsonb           | `{ before?, after?, meta? }`；敏感值（Key、token、密码）不落库 |
| `ip`          | text            | 可选                                                           |
| `created_at`  | timestamptz     | 默认 `now()`                                                   |

索引：`(created_at desc)`、`(action, created_at desc)`、`(target_id, created_at desc)`。

只在管理端写操作**成功提交后**写入；失败不写。审计写入失败不得回滚业务操作（`try/catch` + log）。

### 4.3 `admin_console_device_grants`

| 字段         | 类型              | 说明                                           |
| ------------ | ----------------- | ---------------------------------------------- |
| `id`         | uuid PK           |                                                |
| `device_id`  | uuid → devices.id | `on delete cascade`                            |
| `audience`   | text              | `all`（全员） / `users`（指定人）              |
| `user_id`    | text → users.id   | `audience='users'` 时必填，`on delete cascade` |
| `granted_by` | text → users.id   | `on delete set null`                           |
| `created_at` | timestamptz       |                                                |

- 唯一索引：`(device_id) WHERE audience='all'`；
- 唯一索引：`(device_id, user_id) WHERE audience='users'`。

**v1 语义：一台设备只有一种受众。** 切换「全员 ↔ 指定人」时在同一事务里清掉另一类记录，避免「既全员又名单」的叠加语义。升级到「全员 + 例外名单」留到 P4。

### 4.4 `devices` 增量

文件是 **`packages/database/src/schemas/device.ts`**（不是 `workspace.ts`）。只加一列，不改既有语义：

| 字段   | 类型              | 说明                     |
| ------ | ----------------- | ------------------------ |
| `pool` | text，默认 `null` | `'admin'` = 管理员池设备 |

配套部分唯一索引：

```sql
CREATE UNIQUE INDEX devices_admin_pool_device_id_unique
  ON devices (device_id) WHERE pool = 'admin';
```

即同一台机器在池里只能有一条，但不与各人的个人注册冲突（个人注册的唯一键仍是 `(user_id, device_id) WHERE workspace_id IS NULL`）。

池设备复用注册者原有的**个人行**：`userId` = 注册它的管理员，`workspaceId` 保持 `NULL`，`visibility` 保持默认 `private`（不参与 workspace 可见性计算）。`DeviceModel.register` 的 upsert `set` 列表里没有 `pool`，因此普通 `lh device register` 不会把池标记冲掉。

### 4.5 迁移

- `9001_admin_console.sql`：两张新表 + `devices.pool` 列 + 三个索引；
- journal `idx` 按 Drizzle 顺序递增（CUST-002 的 `9000_nosy_tag` 已占），合并上游时只顺延、不重排；
- 迁移必须可重复执行（`IF NOT EXISTS`），P1 验收在真实 PostgreSQL 上跑两遍。

## 5. AI 服务托管

### 5.1 配置解析顺序

```
管理员配置 (admin_console_settings.ai, 仅存在的键)
  > 服务端环境变量（<PROVIDER>_MODEL_LIST、ENABLED_<PROVIDER>、DEFAULT_AGENT_CONFIG、SYSTEM_AGENT）
  > 代码默认（DEFAULT_LLM_CONFIG / DEFAULT_AGENT_CONFIG / DEFAULT_SYSTEM_AGENT_CONFIG）
```

实现上只在一处合并：`getServerGlobalConfig()` 返回值里的 `aiProvider` / `defaultAgent` 用管理员配置覆盖（`systemAgent` 不进这里，它是用户列，见 §5.3）。

```ts
// apps/server/src/globalConfig/index.ts:184 附近
const ai = await getAdminAiDefaults();           // business 层，未配置 → undefined
aiProvider: await genServerAiProvidersConfig(getAiProviderSpecificConfig(), ai?.providers),
defaultAgent: { config: merge(parseAgentConfig(DEFAULT_AGENT_CONFIG), ai?.defaultModel) },
```

这条链只解决「用户没有自定义时拿到的默认值」。**Provider 启停与模型白名单不走这里**：`getServerGlobalConfig` 只能改 `providerConfigs`，而 `AiInfraRepos.getAiProviderList` 的 `enabled` 是「用户行 `enabled` **OR** `providerConfigs[id].enabled`」的或关系，用户自己开过的 provider 会把被 env 关掉的 provider 拉回来。白名单走 §5.4 的过滤链。

### 5.2 传播：保存即全量覆盖

管理员保存 `ai` 时，一个事务内完成：

1. 写 `admin_console_settings.config.ai`；
2. 批量更新 `user_settings`：
   - `language_model` ← `ai.defaultModel`
   - `default_agent` ← 保留用户其它 agent 字段，只覆盖 `config.model` / `config.provider`
   - `system_agent` ← 按 `SERVICE_MODEL_TIER_SLOTS` 把四个层级展开到各自槽位，再与既有值 `merge`；`asr`、`channelRouting`、`fileEmbedding`、onboarding 这类独立槽位不在托管范围，保持原值（`fileEmbedding` 必须保留：换模型会让已入库的向量失效）
3. 写审计（`ai.update`，含 before/after 摘要）。

**不做「仅补齐」模式**：这三个字段本身就是托管字段。

规模处理：

- `≤500` 用户：请求内同步完成，返回影响人数；
- `>500`：写入配置后转后台任务，页面显示「配置已保存，正在同步 N 位用户」；后台任务复用现有 asyncTask / 队列。

新用户：`packages/business-server/src/user.ts` 的 `initNewUserForBusiness` 里追加一次物化（该钩子已由 `UserService.initUser` 调用，**不需要**改 `initUser`）。`try/catch`，失败不阻塞登录。

### 5.3 运行时兜底：托管槽位不可被用户改写

`user_settings.system_agent` 同一列里既有托管槽位（服务模型四层），也有个人槽位（ASR、chat-preference、fileEmbedding、channelRouting）。所以**不能整列拒绝**，否则会连 ASR 设置一起挡掉。

做法：在 `settingsRouter.updateSettings` 里，把入参的 `system_agent` 交给 business 助手处理一次：

```ts
// packages/business-server/src/adminConsole/settingsPolicy.ts
/** 托管槽位强制使用管理员值；其余槽位原样保留。未启用托管时原样返回 */
export const applyManagedSettingsPolicy = async (ctx, settings) => { ... };

/** languageModel / defaultAgent.config 只允许白名单内的模型，否则返回错误 */
export const assertModelsWithinPolicy = async (ctx, settings) => { ... };
```

共享文件里只加两行调用。这样：

- 用户改服务模型 → 保存成功但托管槽位不变（下一次读取仍是管理员值），不制造报错噪音；
- 用户改 ASR /chat-preference → 完全不受影响；
- 用户把模型切成白名单外的模型 → `FORBIDDEN`（这是明确越权，必须报错）。

### 5.4 白名单与 Provider 启停的生效点

Provider 启停与模型白名单**不**物化到每个用户的行里，而是挂在已有的「按用户隐藏模型」管道上：只改一个 business 实现，所有消费方自动生效。

| 管理员策略                     | 展开成                                   | 结果                                                                                         |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `providers[p].enabled = false` | 该 provider 的**全部内置模型**进隐藏集合 | `enabledAiModels` 里没有它的模型，由模型派生的 `enabledChat/Image/VideoAiProviders` 自动剔除 |
| `providers[p].models = [...]`  | 该 provider 下未勾选的内置模型进隐藏集合 | 只有勾选的模型出现在选择器、模型列表与运行时                                                 |
| `providers[p]` 缺省            | 不隐藏                                   | 保持今天的「用户行 OR 代码默认」                                                             |

**落点只有一个文件**：`packages/business-server/src/aiProvider.ts` 的 `getHiddenBuiltinModelsForUser(userId)`（上游预留给 business 层的替换点，当前恒返回 `[]`）。

```ts
export const getHiddenBuiltinModelsForUser = async (
  userId: string,
): Promise<BuiltinModelIdentifier[] | undefined> => {
  const policy = await getAdminAiPolicyCached(); // 5s 内存缓存；未配置 → null
  if (!policy) return []; // 已解析、无隐藏：与今天完全一致
  return expandToHiddenModels(policy); // 被关 provider 的全部模型 + 未勾选模型
};
```

`expandToHiddenModels` 用 `model-bank` 的 `LOBE_DEFAULT_MODEL_LIST`（`providerId` + `id`）做差集，每次读都按**当前**模型清单重算：上游新增模型会自动落进「未勾选」，不需要迁移数据。为此给 `packages/business-server/package.json` 补 `"model-bank": "workspace:*"`（当前只有类型导入）。

**fail-closed 语义直接复用**（`aiProviderAccess.ts` 的现有行为）：

- 返回 `undefined` = 策略未解析 → `runtimeConfig = {}`、`modelRedirects = {}`、`enabledAiModels = []`；
- 返回 `[]` = 已解析且无隐藏 → 与未接入时完全等价；
- 返回列表 = 过滤 `enabledAiModels`、按模型类型重建三类 provider 列表，并剔除指向被隐藏模型的 `modelRedirects`。

**自动受益的消费方**（不需要逐个改）：`aiProvider.getAiProviderRuntimeState` / `getProviderBindingRuntime`、`aiModel.getAiProviderModelList`、图片运行时、`userMemory/{persona,consolidation,extract/runtime}`、`goal/modelConfig`、`toolExecution/serverRuntimes/agentBuilder`。

**已知边界**

1. 隐藏集合只覆盖 **builtin 模型**（`BuiltinModelIdentifier`）。用户此前自己加的自定义模型不受过滤；v1 依赖「非管理员进不了供应商页新增」+ §5.5 的写拒绝兜住（P4 再做 `runtimeConfig` 层过滤）。
2. `getAiProviderList`（设置页的 provider 元数据）不做过滤：它不含可用模型、密钥已脱敏，非管理员既看不到菜单也改不了，直连读接口不构成越权。
3. 策略读取必须缓存（与菜单策略共用 5s），否则每次 runtime state 解析都会多一次查库。

### 5.5 写拒绝

| 入口                                 | 覆盖范围                                                                                                                                                                                                                  | 实现                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `aiProvider` router 的 6 个 mutation | `createAiProvider`、`toggleProviderEnabled`、`updateAiProvider`、`updateAiProviderConfig`、`updateAiProviderOrder`、`removeAiProvider`                                                                                    | base procedure 加 1 个中间件 |
| `aiModel` router 的 10 个 mutation   | `batchToggleAiModels`、`batchUpdateAiModels`、`clearModelsByProvider`、`clearRemoteModels`、`createAiModel`、`removeAiModel`、`toggleModelEnabled`、`updateAiModel`、`updateAiModelReasoningConfig`、`updateAiModelOrder` | 同上                         |
| `settingsRouter.updateSettings`      | `languageModel`、`defaultAgent.config.model` → 白名单校验；`system_agent` → 托管槽位强制改写                                                                                                                              | 调用 §5.3 的两个助手         |

关键实现细节：两个 router 的所有过程（含读）都建在同一个 `aiProviderProcedure` / `aiModelProcedure` 上。**不要去改 16 个 mutation**，而是给 base 加一个按类型分流中间件：

```ts
// packages/business-server/src/trpc-middlewares/adminManagedAi.ts
export const withManagedAiWriteGuard = trpc.middleware(async (opts) => {
  if (opts.type !== 'mutation') return opts.next(); // 读接口放行
  await assertAdminOnlyOrThrow(opts.ctx); // 非管理员且已启用托管 → FORBIDDEN
  return opts.next();
});
```

```ts
// apps/server/src/routers/lambda/aiProvider.ts —— 只加一个 .use()
const aiProviderProcedure = wsCompatProcedure
  .use(serverDatabase)
  .use(withManagedAiWriteGuard)   // ← 新增这一行
  .use(async (opts) => { ... });
```

`aiModel.ts` 同样一行。业务判断全在 business 层，上游 router 的 diff 只有 2 行。

`updateSettings` 的顺序保持上游现状：`keyVaults` / `market` 的 `model:write` 检查 → workspace RBAC → **托管策略** → `keyVaults` 存在性与加密 → `userModel.updateSetting`。策略判断放在 RBAC 之后，避免把「无权限」误报成「已托管」。

读接口不拦。

### 5.6 菜单隐藏

`showProvider` 已有 env flag `provider_settings`；`showServiceModel` 是新增 flag。

1. `packages/app-config/src/featureFlags/schema.ts`：`FeatureFlagsSchema` 新增 `service_model: FeatureFlagValue.optional()`，默认 `true`（保持现状）；`mapFeatureFlagsEnvToState` 第 309 行旁加一行
   `showServiceModel: evaluateFeatureFlag(config.service_model, userId, 'service_model')`；
2. `packages/types/src/serverConfig.ts`：`ServerFeatureFlags` 加 `showServiceModel: boolean | undefined`（1 行）；
3. `configRouter.getGlobalConfig`：拿到 `serverFeatureFlags` 后叠加管理员策略：

```ts
const menu = await getAdminMenuPolicy(ctx.userId || undefined); // business 层，5s 缓存
return {
  billboard,
  serverConfig,
  serverFeatureFlags: {
    ...serverFeatureFlags,
    enableDevDock: serverFeatureFlags.enableDevDock || businessDevDockAccess,
    showProvider: serverFeatureFlags.showProvider && menu.showProvider,
    showServiceModel: serverFeatureFlags.showServiceModel && menu.showServiceModel,
  },
};
```

`getAdminMenuPolicy` 内部：`userId` 缺失或 `role !== 'admin'` 时按 `config.menu` 判断；管理员恒 `true`；未启用托管时恒 `true`。

两个开关本身由控制台写：落在管理员全局策略（`business/adminConsole/menuPolicy`，一行 jsonb，5s 缓存），保存后清缓存即传播。env 的 `provider_settings` / `service_model` 降为部署级总闸 —— 总闸关闭时管理员也不能单方面打开。原型里这两个开关在「服务模型」页顶部「用户设置里的 AI 菜单」卡片，卡片底部实时给出「用户侧设置里可见什么」的摘要。

4. 客户端接入（各 1 行）：

```tsx
// src/features/Settings/hooks/useCategory.tsx
const { hideDocs, showApiKeyManage, showProvider, showServiceModel } = useServerConfigStore(featureFlagsSelectors);
// 167 行已有 showProvider &&
{ icon: Sparkles, key: SettingsTabs.ServiceModel, label: t('tab.serviceModel'), hide: !showServiceModel },
```

移动端 `src/routes/(mobile)/me/settings/features/useCategory.tsx`（109/112 行）同样处理。

5. 直达 URL 兜底：加一个 `ManagedSettingsGuard`（读同一份 `featureFlags`，非管理员重定向到 `/settings/profile`），挂在 `provider` 与 `service-model` 两个路由段上。v1 可先只做 AI 服务商一个，服务模型待 P2 末尾补；**服务端拒绝写入与白名单才是边界**，重定向只是体验。

### 5.7 用户看到的差异

| 页面           | 非管理员                                                     | 管理员                       |
| -------------- | ------------------------------------------------------------ | ---------------------------- |
| AI 服务商      | 菜单隐藏、路由重定向                                         | 完整编辑                     |
| 服务模型       | 菜单隐藏、路由重定向、托管槽位不可改                         | 完整编辑                     |
| 会话内模型选择 | 只列出管理员启用的 provider /model；可切换，但白名单外被拒绝 | 同左（管理员不受白名单限制） |
| 新用户默认模型 | 取管理员配置                                                 | 同左                         |

## 6. 设备池

### 6.1 模型

产品语义是：设备不再只属于注册它的个人，而是先进管理员的池，再由管理员决定「给所有人」还是「给部分人」。实现上不新增设备种类，只给现有个人行加一个池标记 + 一张授权表。

| 概念       | 实现                          | 说明                                                                                        |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| 全局注册   | `devices.pool = 'admin'`      | 管理员执行 `lh device pool register`，写的是他自己的一条**个人行**（`workspaceId IS NULL`） |
| 归属管理员 | `devices.userId`              | 这就是 owner，也是 gateway 寻址的 principal；`transferOwner` 可换人                         |
| 受众       | `admin_console_device_grants` | `audience='all'`（全员）或 `'users'`（名单），一台设备只有一种                              |
| 可见与可用 | 列表 / 选择器 / 派发          | 被授权的人在 `listDevices`、ChatInput 选择器、`getScopedOnlineDevices` 里看到它             |

**为什么不让 `devices.userId` 为空**：这一列是 gateway 的寻址 principal（`NOT NULL`），设备连接、`queryDeviceList(userId)`、在线状态与执行派发都按它分池。改成「无主」要同时改注册唯一键（`(userId, deviceId) WHERE workspace_id IS NULL`）、gateway 寻址、7 个派发入口与 workspace 语义；「管理员持有 + 池标记」只加一列和一张表，既有路径全部不动。用户看到的语义仍然是「管理员把这台设备分配给了谁」，而不是「它属于某个管理员」。

- **注册**：管理员在要共享的机器上执行 `lh device pool register`，服务端写 `devices`（`pool='admin'`、`userId=注册管理员`、`workspaceId=NULL`）。
- **转移**：`adminPool.transferOwner` 把 owner 换成另一个管理员（换人、离职、或专门的 `svc-admin` 账号）。
- **分配**：`admin_console_device_grants` 决定谁能看到 / 使用；一台设备只有一种受众（全员或名单）。
- **使用**：被授权的用户在设备列表与 ChatInput 设备选择器里看到该设备，选中后由服务端以 owner 的 principal 派发，调用者不感知 owner 是谁。
- **撤销**：删除授权行即刻失效（列表下一次查询即消失），不删除设备注册。
- **连接**：注册只登记，设备仍需 `lh connect`（或设备守护进程）保持在线；池里显示「离线」时执行会被拒绝。

### 6.2 CLI 扩展

现有 `apps/cli/src/commands/device.ts` 的 `registerDeviceCommand(program)` 内部是 `const device = program.command('device')`，再逐个 `device.command('list' | 'info' | 'delete' | 'status')`。因此池命令是同一层级的子命令组，不改变现有四个命令的解析与输出（`list` 会自动多出被授权的池设备行）：

```ts
// apps/cli/src/commands/device.ts —— 唯一改动（1 行）
device.addCommand(createDevicePoolCommand());
```

```ts
// apps/cli/src/commands/devicePool.ts（新文件）
export function createDevicePoolCommand() {
  const pool = new Command('pool').description('Manage the admin device pool');
  pool.command('register').option('--name <name>').action(...);
  pool.command('list').option('--json [fields]').action(...);
  pool.command('grant <deviceId>').option('--all').option('--user <ref...>').action(...);
  // revoke / owner / remove 同构
  return pool;
}
```

```bash
lh device pool register [--name "A100 训练机"]   # 管理员：把当前设备登记进池
lh device pool list [--json]                     # 管理员：池内设备 + 授权范围 + 在线状态
lh device pool grant <deviceId> --all            # 分配给所有人
lh device pool grant <deviceId> --user <工号|邮箱> [--user ...]
lh device pool revoke <deviceId> --all | --user <...>
lh device pool owner <deviceId> --user <管理者>   # 转移 owner（换人 / 离职）
lh device pool remove <deviceId>                 # 从池中移除（清 pool 标记 + 授权）
```

- 注册复用 `apps/cli/src/device/register.ts` 的 `resolveDeviceIdentity()` 与 payload 构造，只把目标 procedure 换成 `device.adminPool.register`；
- 身份取 CLI 当前登录 token；服务端 `adminProcedure` 校验 `role === 'admin'`；
- 非管理员执行时报 `FORBIDDEN`，不静默降级为个人注册；
- 新增文件 `apps/cli/src/commands/devicePool.ts` + `apps/cli/src/device/pool.ts`；`commands/device.ts` 只加一行 `registerDevicePoolCommand(device)`。

### 6.3 服务端

**挂载点：`packages/business-server/src/lambda-routers/device.ts`**（OSS 下是空 `router({})`，已被 `deviceRouter` merge）。它的路径映射是 `@/business/server/lambda-routers/device`，因此：

- 不改 `apps/server/src/routers/lambda/device/index.ts`；
- 不新建 `routers/lambda/adminDevicePool/` 目录；
- 不占用 `routers/lambda/index.ts`（除 `adminConsole` 一处，见 §8）。

| 接口                             | 作用                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `device.adminPool.register`      | 复用 `DeviceModel.register` 写入，再置 `pool='admin'`；唯一冲突时返回已有记录 |
| `device.adminPool.list`          | 池设备 + 授权范围 + owner + 在线状态                                          |
| `device.adminPool.grant`         | `{ deviceId, audience: 'all' \| 'users', userIds? }`，事务内清另一类          |
| `device.adminPool.revoke`        | 撤销授权（全员或指定人）                                                      |
| `device.adminPool.transferOwner` | 改 `devices.userId`（owner 必须是管理员）                                     |
| `device.adminPool.remove`        | 清 `pool` 标记与授权（不删个人注册行）                                        |

写入成功后统一调 `adminConsoleService.audit()`。

### 6.4 可见性（两个接点）

**(a) 运行时选择：`getScopedOnlineDevices`**

```ts
export const getScopedOnlineDevices = async (serverDB, userId, workspaceId?) => {
  ...
  const grantedPoolRows = workspaceId ? [] : await deviceModel.queryGrantedAdminPoolDevices();
  // 按 owner 分组查在线状态，避免 N 次 queryDeviceList
  const poolOnline = await queryOnlineByOwners(groupBy(grantedPoolRows, 'userId'));
  // 合并进结果，标记 adminPool: true；以 deviceId 去重（个人行优先）
};
```

`workspaceId` 存在时整体跳过 ——workspace 会话不暴露池设备（§6.7）。

**(b) 设备列表：`device.listDevices`**

同一份 `queryGrantedAdminPoolDevices()` 合并进返回数组，行上带 `adminPool: true` 与 `grantedAudience`，UI 显示「由管理员分配」。约 8 行。

两个接点都只读，不改写路径。

### 6.5 派发（owner 解析）

调用者点选池设备后，请求里只有 `deviceId`；owner 由**服务端**解析，从不下发到客户端（避免泄露「这台机器属于谁」）。

1. `dispatchAuthorization.ts` 的 personal 分支（当前 `if (!workspaceId) return undefined;`）改成：

```ts
if (!workspaceId) {
  if (!serverDB) return undefined;
  const granted = await new DeviceModel(serverDB, userId).findGrantedAdminPoolDevice(deviceId);
  return granted ? undefined : undefined; // 见下：授权失败交给调用方的既有错误路径
}
```

实际上更好的写法是：新增 `resolveDeviceOwner(serverDB, userId, deviceId)`，返回 `{ ownerId } | { errorData }`；`resolveDeviceDispatchAuthorizationFailure` **保持签名与返回值不变**（它有 6 个调用方），只在内部对池设备做一次授权查询，未授权时返回与「找不到设备」一致的 `DEVICE_NOT_FOUND`。

2. `authorizedToolCall.ts` 在执行前把 principal 换成 owner：

```ts
const ownerId =
  (await resolveDeviceOwner(serverDB, params.userId, params.deviceId)) ?? params.userId;
return deviceGateway.executeToolCall({ ...params, userId: ownerId }, toolCall, timeout);
```

`deviceGateway.executeToolCall` / `deviceGateway/agents.ts` 的签名**不变**，风险只落在这一层。

3. **覆盖范围**：`executeAuthorizedDeviceToolCall` 是 5 个文件 / 7 个调用点（`localSystem` 1、`skills` 3、`browser` 1、`auv` 1、`tfs/deviceCheckout` 1）的唯一出口，改这一处即覆盖「Agent 在池设备上跑工具」这条主路径。

4. **v1 不支持、且 fail closed 的路径**：hetero（Claude Code 等）派发、MCP device tunnel、`device.agents.*` 的配额 / 能力探测 RPC 都直接用 `ctx.userId` 调 gateway，遇到池设备会得到 `DEVICE_NOT_FOUND`。这些入口在 P3 验收中要确认「不会误跑到别人的机器上」，而不是「能跑」。放开它们留到 P4（需要同时改 hetero 的凭据与工作目录语义）。

### 6.6 安全边界

- **授权 = 把该机器的执行权交给对方。** 被授权用户可以让 Agent 在该机器上执行命令（受工具权限与沙箱限制），因此池设备应使用独立工作目录、最小凭据、必要时独立系统账号；
- 池设备不传个人凭据：TFS / Git 凭据仍按调用者注入，设备上不落任何人的 secret（与 CUST-005「共享设备不接收个人凭据」一致）；
- 池设备的 `friendlyName` 由管理员设置，用户不可改；
- 撤销授权后，正在运行的任务不强制中断，但新的派发被拒绝；
- 设备从池移除或 owner 账号删除时，`cascade` 清理授权；**删除 / 禁用管理员前必须先 `transferOwner`**（写进 P3 验收的运维说明）；
- 审计记录 `device.register` / `device.grant` / `device.revoke` / `device.transferOwner` / `device.remove`。

### 6.7 已知边界

- workspace 会话不出现池设备（`workspaceId` 分支直接跳过），workspace 设备继续走既有 `workspaceId` 路径与 `fail closed` 语义；
- 池设备不支持 hetero / MCP tunnel / 设备配额 RPC（§6.5 第 4 点）；
- 一台设备只有一种受众，不支持「全员 + 例外黑名单」；
- `managed cloud device`（`enableManagedCloudDevice`）是平台侧设备，与池设备互不影响。

## 7. 管理端界面

独立路由 `/admin`，不进入主侧边栏。导航顺序即交付顺序：**用户 → 审计 → AI 服务 → 设备**；P1 只渲染前两项，其余随阶段开关出现。

```
/admin
 ├─ 用户                     搜索 / 筛选（全部·管理员·已禁用）/ 列表 / 详情抽屉
 │     └─ 详情：概览 · 设备授权 · 操作（禁用、设/撤管理员、会话失效）
 ├─ 审计                     时间倒序，按 action / actor / target 筛选
 ├─ AI 服务
 │     ├─ Provider 卡片：启停 + 模型多选（按真实 provider 列表渲染）
 │     ├─ 默认模型：provider / model 两级选择
 │     ├─ 服务模型：main / flash / embedding / verify 四个层级
 │     └─ 保存 → 显示「将同步 N 位用户」→ 确认
 └─ 设备
       ├─ 池设备列表：名称、主机、平台、在线、归属管理员、授权范围、最近活跃
       ├─ 行 → 分配抽屉：全员 / 指定人（搜索工号或邮箱）
       ├─ 行 → 更多：转移归属、从池移除
       └─ 空态：给出 `lh device pool register` 命令
```

视觉复刻现有设置页外壳（`NavPanel` 280px、44px 页头、`MAX_WIDTH=1024`、`Form variant="filled" itemsType="group"`），不另造后台风格。

原型 `prototypes/admin-console/index.html`（第五版）按五页重建：用户管理、审计日志、AI 服务商、服务模型、设备。侧栏固定五项 —— 控制台本身只有管理员能进，所以不提供「切换视角」这类入口；AI 两页是现有「设置 → AI 服务商」的 1:1 复刻，服务模型页顶部多一张「用户设置里的 AI 菜单」卡片，把 §5.6 的两个开关做成控制台里的配置。版本与页面批次说明见 `prototypes/admin-console/README.md`。

## 8. 后端接口

`apps/server/src/routers/lambda/adminConsole/`（新目录，需在 `routers/lambda/index.ts` 挂一行）：

| 接口                                    | 作用                                                  |
| --------------------------------------- | ----------------------------------------------------- |
| `whoami`                                | `{ isAdmin, role, canBootstrap }`，首次访问做惰性提权 |
| `listUsers`                             | 分页 + 搜索，join 账号摘要                            |
| `getUser`                               | 详情：账号、角色、状态、设备授权                      |
| `setUserRole` / `banUser` / `unbanUser` | 账号操作（包装 Better Auth admin）                    |
| `revokeUserSessions`                    | 会话失效                                              |
| `getAiConfig` / `updateAiConfig`        | 读写 AI 托管配置，保存返回 `affectedUsers`            |
| `listAudit`                             | 审计分页 + 筛选                                       |

设备池接口见 §6.3，挂 `device.adminPool.*`。

账号类能力直接复用 Better Auth admin 插件（`listUsers` / `banUser` / `setRole` / `revokeUserSessions`），只对「需要聚合展示」的列表做自有查询。

## 9. 对现有代码的侵入清单

原则：**优先用上游预留的扩展槽**；必须改的共享文件只加一处接点，且每处 ≤ 10 行。

### 9.1 新增文件（全部 Fork 自有，不参与上游冲突）

```
packages/types/src/adminConsole.ts
packages/database/src/schemas/adminConsole.ts
packages/database/src/models/adminConsole.ts
packages/database/migrations/9001_admin_console.sql
apps/server/src/services/adminConsole/{index,ai,menu,audit,users,devicePool}.ts
apps/server/src/routers/lambda/adminConsole/{index,procedures,users,ai,audit}.ts
packages/business-server/src/adminConsole/{policy,settingsPolicy}.ts
packages/business-server/src/trpc-middlewares/adminManagedAi.ts
src/features/AdminConsole/**
src/routes/admin/**
src/services/adminConsole.ts
src/store/adminConsole/**
packages/locales/src/default/adminConsole.ts
apps/cli/src/commands/devicePool.ts
apps/cli/src/device/pool.ts
```

### 9.2 必须修改的共享文件

**A. 上游已预留的扩展槽（改的是 business 层实现，不是共享逻辑）**

| 文件                                                    | 改动                                                                              | 风险                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------ |
| `packages/business-server/src/aiProvider.ts`            | 实现 `getHiddenBuiltinModelsForUser`（+ `model-bank` 依赖）                       | 低，上游指定的替换点     |
| `packages/business-server/src/user.ts`                  | `initNewUserForBusiness` 里加一次 AI 配置物化                                     | 低，已被 `initUser` 调用 |
| `packages/business-server/src/lambda-routers/device.ts` | 在空 `router({})` 里补 `adminPool.*`（已被 `deviceRouter` merge，汇总文件零改动） | 低                       |
| `packages/business-server/package.json`                 | 补 `"model-bank": "workspace:*"`                                                  | 极低                     |

**B. 设备链（6 处，按风险从低到高）**

| 文件                                                              | 改动                                                                                                                   | 风险 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---- |
| `packages/database/src/schemas/device.ts`                         | `pool` 列 + 部分唯一索引                                                                                               | 极低 |
| `packages/database/src/models/device.ts`                          | 新增 `queryAdminPoolDevices` / `queryGrantedAdminPoolDevices` / `findGrantedAdminPoolDevice` / `setPool`（纯新增方法） | 低   |
| `apps/server/src/routers/lambda/device/registry.ts`               | `listDevices` 合并被授权池设备（\~8 行）                                                                               | 中低 |
| `apps/server/src/services/deviceGateway/scopedDevices.ts`         | 合并池设备 + 按 owner 批量查在线（\~15 行）                                                                            | 中   |
| `apps/server/src/services/deviceGateway/dispatchAuthorization.ts` | personal 分支对池设备做授权校验（签名不变，\~10 行）                                                                   | 中   |
| `apps/server/src/services/deviceGateway/authorizedToolCall.ts`    | 派发前 owner 解析（\~3 行）                                                                                            | 中   |

**C. AI 托管（5 处，每处 ≤ 6 行）**

| 文件                                              | 改动                                                                   | 风险               |
| ------------------------------------------------- | ---------------------------------------------------------------------- | ------------------ |
| `apps/server/src/globalConfig/index.ts`           | `aiProvider` / `defaultAgent` 用管理员默认值覆盖                       | 低                 |
| `apps/server/src/routers/lambda/aiProvider.ts`    | base procedure `+ .use(withManagedAiWriteGuard)`                       | 低                 |
| `apps/server/src/routers/lambda/aiModel.ts`       | 同上                                                                   | 低                 |
| `apps/server/src/routers/lambda/user/settings.ts` | 调用 `applyManagedSettingsPolicy` + `assertModelsWithinPolicy`（2 行） | 中，需回归设置保存 |
| `apps/server/src/routers/lambda/config/index.ts`  | 菜单策略合并（4 行）                                                   | 低                 |

**D. 菜单与路由（6 处，每处 1 行 / 1 段）**

| 文件                                                       | 改动                                           |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `packages/app-config/src/featureFlags/schema.ts`           | `service_model` flag + `showServiceModel` 映射 |
| `packages/types/src/serverConfig.ts`                       | `ServerFeatureFlags` 加 `showServiceModel`     |
| `src/features/Settings/hooks/useCategory.tsx`              | 服务模型条目加 `hide`                          |
| `src/routes/(mobile)/me/settings/features/useCategory.tsx` | 同上                                           |
| `src/spa/router/desktopRouter.shared.tsx`                  | 注册 `/admin`                                  |
| `src/libs/better-auth/auth-client.ts`                      | 导出 `admin`                                   |

**E. 汇总与 CLI（2 处）**

| 文件                                      | 改动                                   |
| ----------------------------------------- | -------------------------------------- |
| `apps/server/src/routers/lambda/index.ts` | 挂 `adminConsole`（import + 1 个 key） |
| `apps/cli/src/commands/device.ts`         | 注册 `pool` 子命令组（1 行）           |

**合计**：新增 22 个文件 + 3 个目录（`src/features/AdminConsole/**`、`src/routes/admin/**`、`src/store/adminConsole/**`）；修改 23 个既有文件，其中 17 处是 1–6 行的接点，6 处集中在设备链（P3，最后做）。

### 9.3 刻意不做的改动

- 不改 `AiInfraRepos`（`getAiProviderList` / `getEnabledModels`）与 `apps/server/src/services/aiProviderAccess.ts`；
- 不改 `DEFAULT_PREFERENCE` / `DEFAULT_SETTINGS` / `DEFAULT_LLM_CONFIG`；
- 不改 `getUserSettings` / `getUserPreference` / `getUserState` 的读取链；
- 不改 agent 运行时读取逻辑；
- 不改 `deviceGateway.executeToolCall` / `deviceGateway/agents.ts` 的签名；
- 不改 `apps/server/src/routers/lambda/device/index.ts`（池接口走 `businessDeviceRouter`）；
- 不改 workspace 设备的可见性与 `fail closed` 语义；
- 不新增认证 Provider 或中间件。

## 10. 分阶段

### P0 设计（本版）

设计文档 + 原型结构更新。本轮结束。

### P1 用户管理与审计（可独立上线）

1. `9001_admin_console.sql` 的 `admin_console_settings` / `admin_console_audit_logs` 两表 + model；
2. `adminConsole` router（`whoami` / `listUsers` / `getUser` / 账号操作 / `listAudit`）+ 在 `routers/lambda/index.ts` 挂载；
3. 管理员引导与首次提权（`ADMIN_CONSOLE_BOOTSTRAP_*`）；
4. `/admin` 用户页 + 审计页 + `/admin` 路由注册。

这一阶段不碰写入拦截、不碰运行时配置、不碰设备链，可以先上线。上线时 `/admin` 导航只有「用户管理」「审计日志」两项；`adminConsole` router 也只实现 `whoami` / `listUsers` / `getUser` / 账号操作 / `listAudit`，AI 与设备接口留到对应阶段再加。

### P2 AI 服务托管

1. `admin_console_settings.ai` 与 business 策略读取（5s 缓存）；
2. `getServerGlobalConfig` 覆盖（默认值链）；
3. `updateAiConfig` + 三列传播 + 新用户物化；
4. **白名单**：`getHiddenBuiltinModelsForUser` 读策略 + `model-bank` 依赖；
5. 菜单策略（`service_model` flag + `configRouter` 合并 + 客户端两处 + 重定向守卫）；
6. 写拒绝：两个 base procedure 的守卫中间件 + `updateSettings` 的两个助手调用；
7. `/admin` AI 服务页。

顺序建议：先 4 再 6。白名单先落地就能在真实会话里看到效果，写拒绝随后封住后门；反过来先封写会把管理员自己在联调时的编辑也挡住。

### P3 设备池

1. `devices.pool` + 授权表 + 迁移；
2. `device.adminPool.*`（写入 `business-server/src/lambda-routers/device.ts`）；
3. `lh device pool` 子命令组；
4. `listDevices` 合并；
5. `getScopedOnlineDevices` 合并 + `dispatchAuthorization` / `authorizedToolCall` 的 owner 解析；
6. `/admin` 设备页 + 分配抽屉 + 转移归属；
7. 单测与设备验收（含「未授权用户选不到也派不到」）。

把设备池放最后，因为它改的是共享执行链，需要最长的回归窗口。

### P4 与平台权限对齐

- SSO `roleCodes` → `users.role`；
- 可选接入 RBAC 权限码替代固定 `role='admin'`；
- 池设备开放 hetero / MCP tunnel；「全员 + 例外名单」；自定义模型过滤；
- 一次性 enrollment token（不走管理员本人 CLI 登录态）。

## 11. 上游合并检查点

按顺序逐条确认：

1. `define-config.ts` 的 `admin()` 是否仍在；被移除则账号操作改自研 RPC。
2. `initUser` → `initNewUserForBusiness` 钩子是否仍在；签名变化则同步物化调用。
3. `user_settings` 三列（`language_model` / `default_agent` / `system_agent`）是否改名或拆列。
4. `GlobalServerConfig` 的 `aiProvider` / `defaultAgent` 结构是否变化。
5. `configRouter.getGlobalConfig` 的返回结构；`serverFeatureFlags` 是否改名；`businessConfigEndpoints` 是否仍在末尾 spread。
6. `mapFeatureFlagsEnvToState` 是否新增必填字段（影响 `showServiceModel` 的落位）。
7. `settingsRouter.updateSettings` 是否拆分或改签名；策略判断必须跟到新入口。
8. `devices` 表结构与 `DeviceModel` 查询方法（`queryPersonal` / `queryWorkspaceDevices` / `register`）是否变化；`register` 的 upsert `set` 是否新增了会覆盖 `pool` 的字段（若新增，需在 `set` 里排除 `pool`）。
9. `getScopedOnlineDevices` 与 `executeAuthorizedDeviceToolCall` 的参数形态；owner 解析要跟着改。
10. `deviceRouter` 是否仍 `mergeRouters(..., businessDeviceRouter)`；`businessDeviceRouter` 是否仍为空 router。
11. `apps/cli/src/device/register.ts` 的 payload 与 `resolveDeviceIdentity` 签名。
12. 迁移编号：继续用 `9000+`，不占用上游编号。
13. `apps/cli/src/commands/device.ts` 的 `registerDeviceCommand` 是否仍以 `program.command('device')` 起步、现有子命令名是否新增了与 `pool` 冲突的项；`apps/cli/src/device/register.ts` 的 `resolveDeviceIdentity()` 仍可复用。

### 本轮复查记录（2026-11-20，`upstream/canary` `1ce7bdcefb`）

- 第 1 条：`admin()` 仍启用。
- 第 2 条：`initUser` → `initNewUserForBusiness` 调用未变（`apps/server/src/services/user/index.ts:30`）。
- 第 8–11 条：设备链未变；`devices` 在 `schemas/device.ts`；`businessDeviceRouter` 仍为空 router；`workspace.ts` 的 `shareDeviceToWorkspace` / `setWorkspaceDeviceVisibility` 保持原样，池设备不走进这两条路径。
- 第 3–7 条：本轮上游未改动，实施前再核对一次。

## 12. 验收清单

**P1 产品行为**

- [ ] 管理员能在 `/admin/users` 搜到用户、禁用后该用户无法建立新会话；
- [ ] 设 / 撤管理员立即生效，`whoami` 同步；
- [ ] 禁用、改角色、撤销会话各产生一条审计，含前后值；
- [ ] 非管理员访问 `/admin/*` 被拒绝（服务端 `FORBIDDEN`，不只隐藏菜单）。

**P2 产品行为**

- [ ] 未配置 AI 托管时，新用户与服务端运行行为与现在完全一致（`enabled: false` 短路）；
- [ ] 管理员关闭某 Provider 后，用户会话内模型选择器不再出现该 Provider 的模型；
- [ ] 管理员改服务模型后，已有用户与新用户看到的服务模型页一致；
- [ ] 非管理员改服务模型成功但托管槽位不变；改 ASR /chat-preference 正常生效；
- [ ] 非管理员把模型切到白名单外返回 `FORBIDDEN`；
- [ ] 非管理员调用 `aiProvider` / `aiModel` 任一 mutation 返回 `FORBIDDEN`；
- [ ] 非管理员看不到「AI 服务商」「服务模型」菜单；直达 URL 被重定向；
- [ ] 管理员自己不受上述限制。

**P3 产品行为**

- [ ] `lh device pool register` 后设备出现在 `/admin` 设备页，且 `lh device list` 只对管理员显示池标记；
- [ ] 分配「全员」后，任意用户在自己的设备列表看到并可选中，Agent 工具（local tool /browser/skills 各一条）在该机器上执行成功；
- [ ] 分配「指定人」后，未授权用户在列表与选择器里都看不到，直接构造 dispatch 被拒绝；
- [ ] 撤销授权后，用户下一次刷新即看不到，新的派发被拒绝；
- [ ] 池设备执行不落任何调用者的个人凭据；
- [ ] workspace 会话不会出现池设备，`fail closed` 语义未变；
- [ ] 删除 / 禁用 owner 前 `transferOwner` 可让设备继续可用。

**工程验证**

- [ ] 迁移在真实 PostgreSQL 上执行通过，重复执行幂等；
- [ ] 三列传播的 dry-run 人数与实际一致；
- [ ] `pnpm exec tsrs --noEmit -p tsconfig.type-check.json` 退出码 0；
- [ ] 改动文件 oxlint 0 error；
- [ ] 相关单测：菜单策略、写拒绝、托管槽位强制、白名单校验、授权查询、owner 解析；
- [ ] 上游合并演练按第 11 节逐条复查并记录到 `CUSTOMIZATIONS.md`。

## 13. 产品决策

### 13.1 已定稿

1. **只做三块**（产品方本轮确认）：用户 + 审计、AI 托管、设备池。外观 / 快捷键 / 数据统计不做管理入口（§1.2），也不留空壳页面。
2. **默认模型与服务模型的传播时机**：保存即全量覆盖。不提供「仅补齐」，也不再加一次「同步到存量用户」按钮。
3. **用户在白名单内可自由切换模型**，但不能新增 provider / 模型，也不能改服务模型 —— 「统一控制」管的是可用范围与默认值，不是锁死单次选择。
4. **池设备的注册鉴权**：管理员自己的 CLI 登录态（`lh device pool register`），非管理员返回 `FORBIDDEN`。一次性 enrollment token 留到 P4。
5. **owner 不下发客户端**：只有服务端在派发前解析，UI 只显示 `adminPool` 标记与「归属管理员」列（管理端）。

### 13.2 采用建议值，实施中可推翻

6. **`systemAgent` 的托管粒度**：只托管 `main` / `flash` / `embedding` / `verify` 四个层级，按 `SERVICE_MODEL_TIER_SLOTS` 展开到槽位；`asr`、`channelRouting`、`fileEmbedding`、onboarding 等独立槽位保留用户值（`fileEmbedding` 必须保留）。
7. **Provider 的模型白名单**：只允许管理员勾选的模型；未勾选的不出现在用户选择器，直接调用由服务端隐藏。
8. **池设备执行范围**：v1 只支持个人会话的 Agent 工具派发；workspace 会话与 hetero / MCP tunnel 留到 P4。
9. **一台设备一种受众**：全员或名单，不支持叠加。
10. **审计保留期**：永久保留，v1 不做归档。量级按管理动作而非用户动作计算，可接受。
