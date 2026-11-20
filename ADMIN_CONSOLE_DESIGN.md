# 管理员控制台（CUST-008）设计方案

> 状态：设计评审（第六版）。尚未改产品代码。
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

第五版把原型扩到五页（用户 / 审计 / AI 服务商 / 服务模型 / 设备），设计正文未改。

第六版**不改架构**，按「一个用户从登录到被治理、一台设备从注册到被派发」把链路走通，补齐实现前必须回答的空白（§14–§16），并订正三处与代码不符的假设：

| 订正 | 原假设 | 实际 |
| ---- | ------ | ---- |
| 设备 owner 变更 | `transferOwner` 改一行 `devices.userId` 即可 | `deviceId = sha256(machineId\|userId\|SALT)`，换 owner 必然换 deviceId；只改一行会让设备永久离线（§6.8） |
| 关闭托管 | `enabled: false` 后「行为与未安装完全一致」 | 已物化到 `user_settings` 的值不会回滚；只能保证「不再强制写入 / 不再过滤」（§5.2.1） |
| 服务模型槽位 | 原型 README 写「19 个槽位」 | `SERVICE_MODEL_TIER_SLOTS` 实际 15 个（§5.2） |

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
| 管理员字段          | `users.role` / `banned` / `banReason` / `banExpires` 已存在（Better Auth admin 插件要求）                                                                                   | `packages/database/src/schemas/user.ts:38-43`                                                              |
| 设备身份派生        | `deviceId = sha256(machineId\|userId\|SALT).slice(0,32)`，**同一台机器不同用户是不同的 deviceId**                                                                          | `packages/device-identity/src/index.ts:54`                                                                 |
| API Key 鉴权        | 只校验 key 自身的 `enabled` / `expiresAt`，**不校验 `users.banned`**                                                                                                        | `packages/trpc/src/lambda/context.ts:40-65`                                                                |
| OIDC 鉴权           | 已校验用户状态（`assertOIDCUserActive`），禁用后旧 token 立即失效                                                                                                           | `packages/trpc/src/lambda/context.ts:352`                                                                  |

**六条关键结论**

1. **菜单显隐有现成管道，但必须改 `getGlobalConfig` 本身。** `businessConfigEndpoints` 只提供**新增** procedure（且被 spread 在最后，无法优雅覆写既有 `getGlobalConfig`），所以菜单合并只能在共享文件里加 4 行 + 一个 business 函数，照抄 `getDevDockAccess` 的现有写法。不新建 RPC、不新建 store。
2. **「统一控制」必须物化。** 服务端运行直接读 `user_settings` 三列与 `users.preference`；把管理员配置写进这三列，运行时零改动。动态 overlay 会波及 `getUserSettings` / `getUserPreference` / `getUserState` 与多个运行时读取点，不做。
3. **设备池可以不改归属语义。** `devices.userId` 是 gateway 的寻址 principal（NOT NULL），池设备仍由注册它的管理员持有，用户通过授权表获得可见与可用；新增的只是「查询合并」与「派发时把 principal 换成 owner」。
4. **设备池的写接口可以零改动挂载。** `deviceRouter` 已经 `mergeRouters(..., businessDeviceRouter)`，OSS 下 `businessDeviceRouter = router({})`。把 `device.adminPool.*` 写进业务层这个模块即可，**不需要**改 `device/index.ts`，也不需要新建 `routers/lambda/adminDevicePool/`。
5. **设备池的读接口必须是「显式开启」，不能全局可见。** `getScopedOnlineDevices` 有 10 个文件 / 12+ 调用点（含 MCP device tunnel、channel coordinator、hetero share gate、dispatchWorktreeTurn），其中多数不在池设备的支持范围内。给函数加 `includePoolDevices`（默认 `false`），只由 agent 侧枚举显式打开：`toolExecution/serverRuntimes/remoteDevice.ts:78`、`aiAgent/pipeline/toolDiscovery/reads.ts:391,422`、`aiAgent/pipeline/turnSetup.ts:603`。`device.listDevices` 走自己的三路并发查询，不经过这个函数（见 §6.4(b)）。其余路径保持「看不到」，而不是「先列出、再派发失败」。派发侧仍全部收敛在 `executeAuthorizedDeviceToolCall`。
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
  /**
   * 是否启用托管。false 时策略短路：不再覆盖默认值、不再隐藏模型、不再拦截写入。
   * 已物化的 user_settings 值**保留**，不自动回滚 —— 语义见 §5.2.1。
   */
  enabled: boolean;
  ai: {
    /** providerId → 是否启用 + 可用模型（models 缺省 = 该 provider 的全部内置模型） */
    providers: Record<string, { enabled: boolean; models?: string[] }>;
    /** 新用户默认模型，写入 defaultAgent.config 与 language_model */
    defaultModel?: { provider: string; model: string };
    /** 4 个层级，按 SERVICE_MODEL_TIER_SLOTS 展开写入 user_settings.system_agent */
    /**
     * 只允许四个层级、且只写 provider/model 两个键。
     * 收窄类型是硬约束：asr / channelRouting / fileEmbedding / onboarding 与
     * 各槽位的 customPrompt / contextLimit 不得被托管覆盖（§5.2）。
     */
    systemAgent?: Partial<Record<ServiceModelTier, { provider: string; model: string }>>;
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
| `action`      | text            | `user.ban` / `user.unban` / `user.role` / `user.bootstrapAdmin` / `user.revokeSessions` / `ai.update` / `ai.providerUpdate` / `ai.modelUpdate` / `settings.menu` / `device.register` / `device.grant` / `device.revoke` / `device.transferOwner` / `device.remove` |
| `target_type` | text            | `user` / `settings` / `device`                                 |
| `target_id`   | text            | 目标 id                                                        |
| `detail`      | jsonb           | `{ before?, after?, meta? }`；敏感值（Key、token、密码）不落库 |
| `ip`          | text            | 可选                                                           |
| `created_at`  | timestamptz     | 默认 `now()`                                                   |

索引：`(created_at desc)`、`(action, created_at desc)`、`(target_id, created_at desc)`。

只在管理端写操作**成功提交后**写入；失败不写。审计写入失败不得回滚业务操作，但必须可见：`console.error('[admin-console][audit] write failed', { action, targetId, error })` + `debug('lobe-server:admin-console:audit')`；有 metrics 时递增 `admin_console_audit_write_failed_total`，没有时至少落 error 级日志供采集。

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
- 唯一索引：`(device_id, user_id) WHERE audience='users'`；
- `CHECK (audience IN ('all', 'users'))`；
- `CHECK ((audience = 'users' AND user_id IS NOT NULL) OR (audience = 'all' AND user_id IS NULL))` —— 否则 `audience='users'` 但 `user_id IS NULL` 的行会同时躲过两条部分唯一索引，产生「授权给空」的脏数据。

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

- `9001_admin_console.sql`：两张新表 + `devices.pool` 列 + **6 个索引**（`admin_console_audit_logs` 3 个普通索引、`admin_console_device_grants` 2 个部分唯一索引、`devices` 1 个部分唯一索引）；
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
2. **按变更键差量传播**，不是每次保存都全量覆盖。若 `config.enabled === false`，跳过本步与审计里的用户列摘要，只写 `admin_console_settings`：
   - 只有 `defaultModel` 变化时才写 `language_model` 与 `default_agent.config.model/provider`；
   - 只有某个层级（main / flash / embedding / verify）变化时才写该层展开的槽位；
   - provider 白名单、`menu` 变化**不写**任何 `user_settings` 列（只影响隐藏集合与菜单显隐）。

   这样「管理员关掉一个模型」不会把所有人的模型选择重置回管理员默认（review 发现的语义冲突）。写入时仍与既有值 `merge`，`asr`、`channelRouting`、`fileEmbedding`、onboarding 等独立槽位与 `customPrompt` / `contextLimit` 保持原值（`fileEmbedding` 必须保留：换模型会让已入库向量失效）。
3. 写审计（`ai.update`，含 before/after 摘要）。

**不做「仅补齐」模式**：托管键的变化是覆盖，但没变化的键不重写（见上面的差量传播）。

规模处理：

- `≤500` 用户：请求内同步完成，返回影响人数；
- `>500`：写入配置后转后台任务，页面显示「配置已保存，正在同步 N 位用户」；后台任务复用现有 asyncTask / 队列。

新用户：`packages/business-server/src/user.ts` 的 `initNewUserForBusiness` 里追加一次物化（该钩子已由 `UserService.initUser` 调用，**不需要**改 `initUser`）。`try/catch`，失败不阻塞登录。

**保存前校验（review 补充）**：`defaultModel` 与四个层级引用的 `provider/model` 必须 ∈ 本次 `providers` 白名单（缺省 = 该 provider 全部内置模型）；否则返回 `BAD_REQUEST`，不允许出现「默认模型自己不在白名单里」。

**白名单移除在用模型**：保存前返回影响面「当前 N 位用户的默认模型引用它」；未带 `force: true` 时拒绝保存，要求先改派 `defaultModel` / 对应层级。避免一次勾选让一批用户的会话直接落到被隐藏的模型上。

#### 5.2.1 关闭托管的语义（订正）

`enabled: false` **不能**让已物化的用户配置「回到未安装状态」。管理员保存过一次 `defaultModel` / `systemAgent` 之后，值已经写在每个用户的 `user_settings` 里；控制台没有理由、也没有能力区分「这是管理员设的」还是「用户后来自己改的」。

因此把 `enabled` 的定义收窄为「**策略是否生效**」，而不是「数据是否存在」：

| 面 | `enabled: true` | `enabled: false` |
| -- | --------------- | ---------------- |
| 默认值覆盖（`getServerGlobalConfig`） | 生效 | 不生效，回到 env / 代码默认 |
| 模型隐藏（`getHiddenBuiltinModelsForUser`） | 生效 | 返回 `[]`，不隐藏 |
| 写入拦截（`withManagedAiWriteGuard` / `updateSettings` 策略） | 生效 | 不生效，用户可自由改 |
| 菜单隐藏 | 按 `menu` 配置 | 全部放开 |
| 已物化的 `user_settings` 三列 | 管理员值 | **保留最后一次管理员值**，用户可自行覆盖 |
| 管理员保存配置时的传播 | 按变更键写用户列 | **不写用户列**，只更新 `admin_console_settings` |

关闭时的推荐操作顺序（写进控制台文案与验收）：先把 `defaultModel` / `systemAgent` 调成希望用户保留的值，再关 `enabled`。不要指望关闭等于回滚。

真正的「恢复到出厂默认」是另一个动作（`resetManagedSettings`，删掉三列里的托管键），**v1 不提供**：它会覆盖用户期间的合法修改，且没有可靠的 per-user before 快照。

#### 5.2.2 传播的失败与部分成功

- `≤500` 用户：单事务更新**本次变更键**。任一行失败 → 整批回滚，`updateAiConfig` 返回 `INTERNAL_SERVER_ERROR`，配置不落库，避免「配置存了、用户没同步」的半状态。
- `>500` 用户：配置先落库并立即生效（新用户与运行时过滤），存量用户转后台任务：
  - 按批（200 行/批）更新，每批独立事务；
  - 记录 `affected` / `failed` / `finishedAt`（复用现有 asyncTask），页面显示进度；
  - 失败重试不超过 3 次，剩余用户继续用旧值，页面提示「N 位用户未同步，可重新保存」；
  - 任务必须携带 `changedKeys`（`language_model` / `default_agent_model` / `tier:main` / `tier:flash` / `tier:embedding` / `tier:verify` / 空），随 asyncTask payload 落库；每批只应用该集合。
  - **不能**在任务里重算「当前配置的所有键」——那会把差量传播退回全量覆盖，600 用户场景会原样复活 G-31。
  - 不做 per-user 补偿队列：同一组 `changedKeys` 对全量用户应用是幂等的。
- 传播只写三列的**托管键**，不整列覆盖 `system_agent`（§5.3）。

#### 5.2.3 并发保存

两个管理员同时保存时用 `updated_at` 做乐观锁：`updateAiConfig` 入参带 `expectedUpdatedAt`，事务内 `UPDATE ... WHERE updated_at = $expected`，未命中返回 `CONFLICT`，页面提示「配置已被其他管理员修改，请刷新后重试」。不加分布式锁：保存是低频人工动作，冲突时让人重读一次比排队更清楚。

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
4. 缓存是**进程内**内存，保存后本进程立即失效；自部署是单实例（gateway / server 各一个），可接受。将来多副本必须改成 `redisService` 的版本号或 pub/sub 失效，不要在业务层直连 Redis。
5. 管理员豁免不依赖策略缓存：`isAdmin` 按 `users.role` 读（30s 短缓存），避免管理员被自己的策略挡住。

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

管理员不受写拒绝限制，但**仍要留痕**：`withManagedAiWriteGuard` 对 admin 放行时写一条 `ai.providerUpdate` / `ai.modelUpdate`（含 procedure 名、provider/model id、before/after 摘要），这样「管理员从设置页绕过控制台改配置」也能在审计里看到（G-34）。

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

两个开关本身由控制台写：**统一落在 `admin_console_settings.config.menu`**（与 §4.1 同一个单例，不另建 `menuPolicy` 行），由 `updateMenuPolicy` 写入，5s 缓存，保存后清缓存即传播；审计动作 `settings.menu`。env 的 `provider_settings` / `service_model` 降为部署级总闸 —— 总闸关闭时管理员也不能单方面打开。原型里这两个开关在「服务模型」页顶部「用户设置里的 AI 菜单」卡片，卡片底部实时给出「用户侧设置里可见什么」的摘要。

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
| 归属管理员 | `devices.userId`              | 这就是 owner，也是 gateway 寻址的 principal；变更 owner 见 §6.8（不是改一行）               |
| 受众       | `admin_console_device_grants` | `audience='all'`（全员）或 `'users'`（名单），一台设备只有一种                              |
| 可见与可用 | 列表 / 选择器 / 派发          | 被授权的人在 `listDevices`、ChatInput 选择器、`getScopedOnlineDevices` 里看到它             |

**为什么不让 `devices.userId` 为空**：这一列是 gateway 的寻址 principal（`NOT NULL`），设备连接、`queryDeviceList(userId)`、在线状态与执行派发都按它分池。改成「无主」要同时改注册唯一键（`(userId, deviceId) WHERE workspace_id IS NULL`）、gateway 寻址、7 个派发入口与 workspace 语义；「管理员持有 + 池标记」只加一列和一张表，既有路径全部不动。用户看到的语义仍然是「管理员把这台设备分配给了谁」，而不是「它属于某个管理员」。

- **注册**：管理员在要共享的机器上执行 `lh device pool register`，服务端写 `devices`（`pool='admin'`、`userId=注册管理员`、`workspaceId=NULL`）。
- **转移**：owner 变更受 `deviceId` 派生规则约束，必须两阶段完成（§6.8），不能只改 `devices.userId`。
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
- **池是叠加能力，不是替代**（2026-11-20 确认）：v1 不禁止普通用户 `lh device register` / `lh connect` 注册个人设备，池设备只是额外获得「管理员分配」的那一类。企业若要「只能使用池设备」，属 P4 的策略项（新增 `DEVICE_POOL_ONLY` 开关，在 `device.register` 与 `lh connect` 首注册处拦截），不在本轮。

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
| `device.adminPool.transferOwner` | 把 `friendlyName` 与授权行迁到新 owner **已注册的池行**；旧行 `pool=NULL`；**不改任何行的 `userId` / `deviceId`**（§6.8） |
| `device.adminPool.remove`        | 清 `pool` 标记与授权（不删个人注册行）                                        |

`adminPool.*` 直接用 `adminProcedure`（§14.4），自己 `.use(serverDatabase)` 并构造 `new DeviceModel(serverDB, ctx.userId)`，**不依赖** `deviceProcedure` 的 `ctx.deviceModel`。这样它既能在 `businessDeviceRouter` 里独立工作，也不会把管理端语义混进设备运行时接口（`deviceProcedure` 的调用者仍按原有 workspace / personal 校验走）。

写入成功后统一调 `adminConsoleService.audit()`。

### 6.4 可见性（两个接点）

**(a) 运行时选择：`getScopedOnlineDevices`**

```ts
export const getScopedOnlineDevices = async (
  serverDB,
  userId,
  workspaceId?,
  options?: { includePoolDevices?: boolean },
) => {
  ...
  // 默认 false：MCP tunnel / channel coordinator / hetero share gate 等
  // 不在池设备支持范围内的路径，直接看不到池设备（不是先列出再失败）
  const grantedPoolRows =
    options?.includePoolDevices && !workspaceId
      ? await deviceModel.queryGrantedAdminPoolDevices()
      : [];
  // 按 owner 分组查在线状态，避免 N 次 queryDeviceList
  const poolOnline = await queryOnlineByOwners(groupBy(grantedPoolRows, 'userId'));
  // 合并进结果，标记 adminPool: true；以 deviceId 去重（个人行优先只决定数据来源）
};
```

`workspaceId` 存在时整体跳过 ——workspace 会话不暴露池设备（§6.7）。

**(b) 设备列表：`device.listDevices`**

同一份 `queryGrantedAdminPoolDevices()` 合并进返回数组，行上带 `adminPool: true` 与 `grantedAudience`，UI 显示「由管理员分配」。

**合并规则**：同一 `deviceId` 只保留一行；`adminPool` / `grantedAudience` **叠加**到该行，不因「个人行优先」丢标记（否则管理员自己的池设备在 `lh device list` 里看不到 `POOL`）。列表 key 用 `deviceId`，避免重复行。

**返回前必须做裁剪投影**：池设备行 `enroller: null`、`defaultCwd: null`、`workingDirs: []`、`metadata` 只保留平台 / 架构等非敏感字段，且不返回 owner 的 `userId`（管理端接口除外）。现状 `registry.ts` 的行映射会带 `enroller`（含 fullName / username / avatar）、`defaultCwd`、`workingDirs` 与 `metadata`；池设备的 `userId` 就是管理员，原样透传等于把「这台机器属于谁」与该管理员的工作目录布局发给每个被授权用户，直接违反 §13.1 #5。

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

**热路径约束**：`executeAuthorizedDeviceToolCall` 的入参只有 `deviceId / userId / workspaceId / clientKinds / completion`，没有设备列表可传，所以「先判池设备、零额外查询」不成立。v1 明确为：每次派发做一次 `(user_id, device_id)` 唯一索引点查（`devices` 上已有该索引），命中池设备才继续查授权与 owner；结果按 run 缓存 5s。若后续要在调用方传 `poolDeviceHint`，再优化。

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

### 6.8 owner 变更与设备身份（订正）

§6.1 原写「`transferOwner` 把 owner 换成另一个管理员」。对照代码，这是**不可实现的**：

| 事实 | 位置 |
| ---- | ---- |
| `deviceId = sha256(machineId + "\|" + userId + "\|" + SALT).slice(0, 32)` | `packages/device-identity/src/index.ts:54-73` |
| gateway 的连接与寻址键是 `(userId, deviceId)`，`executeToolCall` 原样透传 `params.userId` | `apps/server/src/services/deviceGateway/agents.ts:215-248` |
| 个人设备唯一键是 `(user_id, device_id) WHERE workspace_id IS NULL` | `packages/database/src/schemas/device.ts` |

推论：把 `devices.userId` 从 A 改成 B 之后，

- 设备行里的 `deviceId` 仍是 `hash(machine, A)`；
- 设备上的 CLI 仍以 A 的 token 连接 gateway，连接登记在 `(A, hash(machine,A))`；
- 服务端按 owner=B 寻址 `(B, hash(machine,A))` —— 没有这条连接，**设备永久离线**；
- 即使设备改用 B 登录，`deriveDeviceId(B)` 会得到另一个 `deviceId`，原行成为孤儿。

所以「换 owner」本质是**设备侧换身份重新注册**。v1 定为两阶段：

1. **设备侧**：新 owner 在目标机器上 `lh login` → `lh device pool register`，产生 `pool='admin'` 的**新行**（新 deviceId、新 userId）；
2. **服务端**：`device.adminPool.transferOwner` 只做数据迁移 —— 把旧行的 `friendlyName` 与授权行迁到新行，旧行 `pool=NULL`、清授权（保留为旧 owner 的私人设备），写审计 `device.transferOwner`（detail 含 before/after deviceId）。

因此：

- 控制台的「转移归属」是**两阶段向导**：第一步显示新 owner 需要在设备上执行的命令；第二步在检测到新行后确认迁移。
- `lh device pool owner <deviceId> --user <...>` 只做第二步；找不到新 owner 的对应行时返回 `PENDING_DEVICE_ENROLLMENT`，提示先在新 owner 下注册。
- **离职流程**：接手人在设备上注册 → 迁移授权 → 从池里移除旧行 → 最后禁用旧账号。顺序不能反：先禁用 owner 会让旧连接立刻失效（gateway 按 principal 断连），迁移完成前设备不可用。
- 如果机器本来就是共享服务机、owner 只是「登记人」，最省事的做法是不转移，而是**从池移除 + 新 owner 重新注册 + 重新授权**；向导要允许这条路径。
- P4 的 enrollment token 可以直接解决这件事（token 带池语义，任何人持 token 注册都进池），届时 `transferOwner` 才能退化成「改一行」。

### 6.9 池设备的运行语义

| 问题 | v1 结论 | 理由 |
| ---- | ------- | ---- |
| 多个被授权用户同时用同一台池设备 | **允许并发，不做互斥**（已确认） | gateway 是长连接，工具调用彼此独立；强行加锁会让「全员可用」变成排队。需要独占的场景（改同一份代码、跑同一个端口）由使用约定解决 |
| 同一用户在同一台池设备上开多个会话 | 允许 | 与个人设备一致 |
| 池设备离线时选中 | 选择器显示「离线」，派发返回 `DEVICE_OFFLINE`（既有语义） | 不新增错误码 |
| 派发前 owner 解析频率 | 先判是否池设备；命中才查授权行。缓存实例化在调用方（每次 agent run 一份，`(userId, deviceId) → ownerId`，5s），**不要**用模块级 Map | 热路径与「撤销即生效」的折中，避免跨请求无界缓存 |
| 授权撤销时正在跑的 run | 不中断，后续工具调用按新授权失败（`DEVICE_NOT_FOUND`） | 与 §6.6 一致 |
| 池设备上的凭据 | 不落调用者凭据；TFS / Git 仍按调用者注入 | §6.6 |
| 池设备的 `friendlyName` | 只有管理员可改；用户侧只读 | 「全员」场景下不能被任意用户改名 |
| 设备列表标记 | `adminPool: true` + `grantedAudience`；CLI 多一列 `POOL` | 用户要知道「这不是我的机器」 |

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

| 接口 | 入参 | 作用 / 语义 |
| ---- | ---- | ----------- |
| `whoami` | — | `{ isAdmin, role, canBootstrap, bootstrapConfigured }`；命中 §14.2 名单时惰性提权并写审计 |
| `listUsers` | `{ q?, role?, status?, page, pageSize }` | 分页 + 搜索（email / username / fullName）；`status` = `active` / `banned`；默认 20/页，上限 100 |
| `getUser` | `{ userId }` | 账号、角色、banned、最近活跃、设备授权、最近 20 条审计 |
| `setUserRole` | `{ userId, role: 'user' \| 'admin' }` | 包装 Better Auth `setRole`；撤销最后一个 admin / 改自己 → `CONFLICT` |
| `banUser` | `{ userId, reason, expiresAt? }` | ①② 同事务：禁用全部 API Key + 设 `banned`；③ 尽力撤 session（§14.3） |
| `unbanUser` | `{ userId }` | 清 `banned` / `banReason` / `banExpires`；**不恢复** API Key |
| `revokeUserSessions` | `{ userId }` | 只撤 Web 会话（「踢下线」），不动 API Key；冻结账号用 `banUser` |
| `getAiConfig` | — | `admin_console_settings.config` + `updatedAt` / `updatedBy` |
| `updateAiConfig` | `{ config, expectedUpdatedAt?, force? }` | 写 `config.ai` + 差量传播；返回 `{ affectedUsers, mode: 'sync' \| 'async', changedKeys, blocked?: { reason: 'model-in-use', users } }`（§5.2.2） |
| `updateMenuPolicy` | `{ hideProviderForNonAdmin, hideServiceModelForNonAdmin, expectedUpdatedAt? }` | 写 `config.menu`；审计 `settings.menu`；保存后清策略缓存（§5.6） |
| `listAudit` | `{ action?, actorId?, targetId?, from?, to?, page, pageSize }` | 时间倒序，上限 100/页；v1 不做导出（§15.5） |

设备池接口见 §6.3，挂 `device.adminPool.*`（使用 `adminProcedure`，不走 `deviceProcedure`）。

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
packages/business-server/src/adminConsole/{index,policy,settingsPolicy,bootstrap,role,procedure}.ts
packages/business-server/src/trpc-middlewares/adminManagedAi.ts
packages/env/src/adminConsole.ts
src/features/AdminConsole/**（含 `guard.ts`）
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
| `src/features/User/UserPanel/useMenu.tsx`                  | admin 时插入「管理控制台」入口（1 项）         |
| `src/app/(backend)/api/auth/[...all]/route.ts`             | 拦截 `/api/auth/admin/*` 的 POST（§14.6，~10 行） |

**E. 汇总与 CLI（2 处）**

| 文件                                      | 改动                                   |
| ----------------------------------------- | -------------------------------------- |
| `apps/server/src/routers/lambda/index.ts` | 挂 `adminConsole`（import + 1 个 key） |
| `apps/cli/src/commands/device.ts`         | 注册 `pool` 子命令组（1 行）           |

**合计**：新增 22 个文件 + 3 个目录（`src/features/AdminConsole/**`、`src/routes/admin/**`、`src/store/adminConsole/**`）；修改 24 个既有文件，其中 18 处是 1–6 行的接点，6 处集中在设备链（P3，最后做）。

### 9.3 刻意不做的改动

- 不改 `AiInfraRepos`（`getAiProviderList` / `getEnabledModels`）与 `apps/server/src/services/aiProviderAccess.ts`；
- 不改 `DEFAULT_PREFERENCE` / `DEFAULT_SETTINGS` / `DEFAULT_LLM_CONFIG`；
- 不改 `getUserSettings` / `getUserPreference` / `getUserState` 的读取链；
- 不改 agent 运行时读取逻辑；
- 不改 `deviceGateway.executeToolCall` / `deviceGateway/agents.ts` 的签名；
- 不改 `apps/server/src/routers/lambda/device/index.ts`（池接口走 `businessDeviceRouter`）；
- 不改 workspace 设备的可见性与 `fail closed` 语义；
- 不新增认证 Provider；除 §14.6 的路由拦截外不新增认证中间件。

## 10. 分阶段

### P0 设计（本版）

设计文档 + 原型结构更新。本轮结束。

### P1 用户管理与审计（可独立上线）

1. `9001_admin_console.sql` 的 `admin_console_settings` / `admin_console_audit_logs` 两表 + model；
2. `adminConsole` router（`whoami` / `listUsers` / `getUser` / 账号操作 / `listAudit`）+ 在 `routers/lambda/index.ts` 挂载；
3. 管理员引导与首次提权：`packages/env/src/adminConsole.ts` + `bootstrap.ts` 的惰性提权 + 审计 `user.bootstrapAdmin`（§14.2）；
4. `adminProcedure` 与「最后管理员 / 不能操作自己」保护（§14.2、§14.4）；
5. 禁用级联：撤 session + `ApiKeyModel.disableAllForUser`（§14.3）；
6. `/admin` 路由注册 + 前端守卫 + 用户菜单入口 + 用户页 / 审计页（§14.5）。

实施顺序建议 `1 → 4 → 3 → 5 → 2 → 6`：先把迁移与 `adminProcedure` / 防锁死立起来，才能在真实环境验证提权；页面最后接。

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
14. `packages/device-identity/src/index.ts` 的 `deriveDeviceId` 是否仍把 `userId` 混入哈希；若改成机器级 id，§6.8 的两阶段可以简化。
15. `users` 的 `role` / `banned` / `banReason` / `banExpires` 四列是否仍在；admin 插件若被移除，整套账号操作要自研。
16. `packages/trpc/src/lambda/context.ts` 的 API Key 校验是否新增用户状态检查；若已内置，§14.3 的「禁用时禁用 Key」可降为可选。
17. 上游是否开始使用 `adminClient()` 的 `/api/auth/admin/*` 端点；一旦使用，§14.6 的 404 拦截会让它静默失败，需要改为只放行读接口（`list-users`）。

### 本轮复查记录（2026-11-20，`upstream/canary` `1ce7bdcefb`）

- 第 1 条：`admin()` 仍启用。
- 第 2 条：`initUser` → `initNewUserForBusiness` 调用未变（`apps/server/src/services/user/index.ts:30`）。
- 第 8–11 条：设备链未变；`devices` 在 `schemas/device.ts`；`businessDeviceRouter` 仍为空 router；`workspace.ts` 的 `shareDeviceToWorkspace` / `setWorkspaceDeviceVisibility` 保持原样，池设备不走进这两条路径。
- 第 3–7 条：本轮上游未改动，实施前再核对一次。
- 第 14–16 条（本轮新增核对）：`deriveDeviceId` 仍混入 `userId`；`users` 四个 admin 字段齐全；API Key 路径仍未检查 `banned`。

## 12. 验收清单

**P1 产品行为**

- [ ] 管理员能在 `/admin/users` 搜到用户、禁用后该用户无法建立新会话；
- [ ] 设 / 撤管理员立即生效，`whoami` 同步；
- [ ] 禁用、改角色、撤销会话各产生一条审计，含前后值；
- [ ] 非管理员访问 `/admin/*` 被拒绝（服务端 `FORBIDDEN`，不只隐藏菜单）。
- [ ] 全新部署配置 `ADMIN_CONSOLE_BOOTSTRAP_EMAILS` 后，命中用户第一次打开 `/admin` 即成为管理员，审计有一条 `user.bootstrapAdmin`（actor=`system:bootstrap`）；两个名单用户先后访问都能各自成为管理员（首次引导）；
- [ ] 从 env 移除该邮箱并重启**不自动撤权**；手工撤销后该用户再访问只剩普通用户视图；
- [ ] 撤销最后一个管理员、禁用自己、改自己的角色，三者都返回 `CONFLICT`；
- [ ] 撤销名单内管理员后，只要还有其他启用 admin，不出现自动回滚；0 admin 时名单内用户访问可接管（恢复通道）；
- [ ] 直接 `POST /api/auth/admin/ban-user` 返回 404（§14.6）；
- [ ] 禁用用户后其已有 Web 会话立即失效、其 API Key 调用返回 401；解禁后 Key 仍不可用（需重建）；
- [ ] 非管理员直达 `/admin` 被重定向到首页，直接调用 `adminConsole.listUsers` 返回 `ADMIN_REQUIRED`。

**P2 产品行为**

- [ ] 未配置 AI 托管时，新用户与服务端运行行为与现在完全一致（`enabled: false` 短路）；
- [ ] 管理员关闭某 Provider 后，用户会话内模型选择器不再出现该 Provider 的模型；
- [ ] 管理员改服务模型后，已有用户与新用户看到的服务模型页一致；
- [ ] 非管理员改服务模型成功但托管槽位不变；改 ASR /chat-preference 正常生效；
- [ ] 非管理员把模型切到白名单外返回 `FORBIDDEN`；
- [ ] 非管理员调用 `aiProvider` / `aiModel` 任一 mutation 返回 `FORBIDDEN`；
- [ ] 非管理员看不到「AI 服务商」「服务模型」菜单；直达 URL 被重定向；
- [ ] 管理员自己不受上述限制。
- [ ] 关闭托管后：新用户拿到 env / 代码默认值，模型不再被隐藏，用户可自行改服务模型；已物化的三列保留最后值（§5.2.1）；
- [ ] 两个管理员并发保存，后提交者得到 `CONFLICT` 而不是静默覆盖；
- [ ] 600 个用户的传播转后台任务，页面能看到进度与失败数；
- [ ] 只改白名单时，用户自己的模型选择保持不变（差量传播，§5.2）；
- [ ] 白名单移除在用模型时返回影响面，未带 `force` 时拒绝保存；
- [ ] 审计写入失败能在日志 / 指标中发现，而不是静默丢弃；
- [ ] 改 embedding 层前有明确警告（换模型会让已入库向量失效），且 `fileEmbedding` 槽位不被托管改写。

**P3 产品行为**

- [ ] `lh device pool register` 后设备出现在 `/admin` 设备页；`lh device list` 对管理员显示池标记，对被授权用户显示 `adminPool` 但不显示 owner；
- [ ] 被授权用户的 `listDevices` payload 不含 owner 标识、`defaultCwd`、`workingDirs` 与敏感 `metadata`（§6.4）；
- [ ] MCP tunnel / channel coordinator / hetero share gate 等路径看不到池设备（`includePoolDevices` 默认关闭）；
- [ ] 分配「全员」后，任意用户在自己的设备列表看到并可选中，Agent 工具（local tool /browser/skills 各一条）在该机器上执行成功；
- [ ] 分配「指定人」后，未授权用户在列表与选择器里都看不到，直接构造 dispatch 被拒绝；
- [ ] 撤销授权后，用户下一次刷新即看不到，新的派发被拒绝；
- [ ] 池设备执行不落任何调用者的个人凭据；
- [ ] workspace 会话不会出现池设备，`fail closed` 语义未变；
- [ ] 删除 / 禁用 owner 前完成 §6.8 的两阶段迁移，设备在新 owner 下继续可用；
- [ ] 只改库、不换设备登录态时，设备在新 owner 下不可用（负向验收，证明两阶段是必需的）；
- [ ] `lh device pool owner` 找不到新 owner 的对应行时返回 `PENDING_DEVICE_ENROLLMENT`；
- [ ] 同一台池设备被两个用户同时使用时，两边工具调用互不串号（日志中 owner 解析正确）。

**工程验证**

- [ ] 迁移在真实 PostgreSQL 上执行通过，重复执行幂等；
- [ ] 三列传播的 dry-run 人数与实际一致；
- [ ] `pnpm exec tsrs --noEmit -p tsconfig.type-check.json` 退出码 0；
- [ ] 改动文件 oxlint 0 error；
- [ ] 相关单测：菜单策略、写拒绝、托管槽位强制、白名单校验、授权查询、owner 解析；
- [ ] 上游合并演练按第 11 节逐条复查并记录到 `CUSTOMIZATIONS.md`；
- [ ] 回归测试：同机器不同 `userId` 派生不同 `deviceId`；跨 owner 寻址失败、同 owner 寻址成功。

### 部署前确认（repo 回答不了）

- [ ] device gateway 是否在连接与派发时校验 `users.banned`，并在禁用后断开该 principal 的在线连接？§6.8 / §15.4 依赖这个前提，`packages/device-gateway-client` 里没有「按用户断开」的接口。
- [ ] gateway 与 server 目前各是单副本？§5.4 / §5.6 的进程内 5s 缓存只在单副本下成立。
- [ ] `.env` 的 `provider_settings` / `service_model` 总闸当前值？为 `false` 时管理员打开菜单开关是无效操作（§5.6）。
- [ ] `ADMIN_CONSOLE_BOOTSTRAP_EMAILS` 是否长期保留？长期保留等于把「误锁死恢复」通道常开，建议引导完成后清空。

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

### 13.3 本轮设计决定（已确认）

以下 11–18 条经产品方于 2026-11-20 确认，按本版实施。

11. **首次提权用 env 邮箱名单**（`ADMIN_CONSOLE_BOOTSTRAP_EMAILS` + 可选 `_USER_IDS`），不做固定初始密码；名单只升不降，移除后不自动撤权（§14.2）。
12. **最后一个管理员不可撤销 / 不可禁用**；bootstrap 名单是误锁死后的恢复手段，数据库直连是兜底。
13. **禁用 = 冻结全部凭据**：撤 Web 会话 + 禁用全部 API Key；解禁不恢复 Key（§14.3）。
14. **v1 不删除用户**，只禁用；删除留到审计 actor 快照化之后。
15. **owner 变更两阶段**（设备侧重注册 + 服务端迁移），控制台不提供「一键改库」（§6.8）。
16. **池设备允许并发使用**，不加互斥锁（§6.9）。
17. **移动端不做 `/admin`**，管理动作只在桌面浏览器完成（§14.5）。
18. **审计 v1 不导出**，只做筛选与分页；需要报表另接 BI。

## 14. 管理员身份与引导链路

这一章回答「谁是管理员、第一个管理员从哪来、怎么不把自己锁在门外」。前五版只写了「`ADMIN_CONSOLE_BOOTSTRAP_*` 惰性提权」，没有定义变量名、触发时机、撤权语义与防锁死，实现时无处落地。

### 14.1 身份判定

| 事实 | 位置 |
| ---- | ---- |
| `users.role` 是可空 `text`；admin 插件要求的 `banned` / `banReason` / `banExpires` 也已在表里 | `packages/database/src/schemas/user.ts:38-43` |
| Better Auth `admin()` 已在 `plugins` 注册 | `src/libs/better-auth/define-config.ts:318` |
| 当前 8 个用户的 `role` 均为 `user`（插件写入），实例里没有管理员 | 2026-11-20 运行时核查 |

判定收敛成一个函数，服务端与前端共用同一语义：

```ts
// packages/business-server/src/adminConsole/role.ts
export const isAdminRole = (role: string | null | undefined) => role === 'admin';
```

- **不新增 `is_admin` 列、不复用 `preference`**：Better Auth 的 `setRole` / `banUser` 直接改 `users.role` / `users.banned`，另起字段必然双写不一致。
- `role` 为 `null` / 空串一律按 `user` 处理（存量用户从 Clerk 迁移而来，不保证有值）。
- 工作区的 `owner` / `admin` 角色与本控制台无关：自部署没有工作区（`workspaces` 0 行），`/admin` 管的是实例级账号。

### 14.2 首次提权：`ADMIN_CONSOLE_BOOTSTRAP_*`

新部署没有任何 `role='admin'` 的用户，而 `/admin` 与所有 `adminProcedure` 都要求 admin —— 先有鸡还是先有蛋。三个候选：

| 方案 | 操作成本 | 风险 | 结论 |
| ---- | -------- | ---- | ---- |
| 手工 SQL `UPDATE users SET role='admin'` | 每次部署一次，需要数据库直连 | 无后门，但要把运维教进容器 | 保留为兜底，不作主路径 |
| 固定初始密码（`ADMIN_CONSOLE_BOOTSTRAP_PASSWORD`） | 低 | 长期存在的共享口令，泄露即提权 | **不做** |
| 邮箱 / 用户名名单（`ADMIN_CONSOLE_BOOTSTRAP_EMAILS`） | 低，改 `.env` 重启 | 名单泄露 = 提权；但可审计、可随时移除 | **采用** |

**变量定义**（新增 `packages/env/src/adminConsole.ts`，与 `packages/env/src/*.ts` 的既有分域一致）：

```ts
export const adminConsoleEnv = {
  /** 逗号分隔，大小写不敏感、两侧空白忽略；命中 email 或 username 即视为管理员候选人 */
  ADMIN_CONSOLE_BOOTSTRAP_EMAILS: process.env.ADMIN_CONSOLE_BOOTSTRAP_EMAILS,
  /** 可选：直接按 user.id 命中（SSO 按工号建号时 id 可能与邮箱不同） */
  ADMIN_CONSOLE_BOOTSTRAP_USER_IDS: process.env.ADMIN_CONSOLE_BOOTSTRAP_USER_IDS,
};
```

```bash
# .env（docker compose 同目录，改完重启容器生效）
ADMIN_CONSOLE_BOOTSTRAP_EMAILS="admin@tellhowsoft.com,ops@tellhowsoft.com"
# 可选；留空表示不启用
ADMIN_CONSOLE_BOOTSTRAP_USER_IDS=""
```

**提权规则（惰性、幂等、只在需要时写库）**

1. 触发点只有两个：`adminConsole.whoami` 与 `adminProcedure` 的守卫中间件。**不在启动时扫全库** —— 部署时 `users` 表里可能还没有这个人（SSO 用户在首次登录时才创建）。
2. 命中条件：`user.id ∈ USER_IDS`，或 `lower(user.email) ∈ EMAILS`，或 `lower(user.username) ∈ EMAILS`。
3. 只升不降：命中且当前 `role !== 'admin'`，并满足以下**任一**条件时执行 `UPDATE users SET role='admin'`，写审计 `user.bootstrapAdmin`：
   - **实例不存在启用状态的 admin** —— 恢复通道，用于误锁死；
   - **该用户从未被 bootstrap 过** —— 首次引导，允许空库一次建出多个管理员。

   「曾被 bootstrap」用审计表判断：存在 `action='user.bootstrapAdmin' AND target_id=userId` 的记录。审计写入失败时最坏结果是允许一次重复提权，可接受。已是 admin 时不写库、不写审计（避免每次 `whoami` 产生一条）。

   这条门槛同时满足三件事：撤销名单内用户后不会自动提权回来（他已 bootstrap 过且有别的 admin）；空库可以建多个管理员；0 admin 时名单仍能接管。
4. 名单移除后**不自动降权**：撤销名单内用户的管理员时，只要实例还有别的启用 admin，撤销生效且不会被惰性提权回滚。名单的定位是「首次引导 + 误锁死恢复」，不是永久超管；引导完成后建议清空 env。
5. 名单为空 / 未配置时 `canBootstrap=false`、`bootstrapConfigured=false`；`whoami` 照常返回 `isAdmin`，页面提示「如需引导，请配置 `ADMIN_CONSOLE_BOOTSTRAP_EMAILS`」。
6. 审计 actor 固定为 `system:bootstrap`（不伪装成用户自己），`detail` 记录命中字段（email / username / userId），**不记录 env 全文**。

**为什么不在注册时提权**：`databaseHooks.user.create.after` 是上游共享钩子（`initUser` 的调用点），在里面读 env 会给所有用户创建路径增加一个 Fork 判断；惰性提权只在有人访问管理面时发生，失败也只影响管理面。

**防锁死（与提权配套）**

- `banUser` / `setUserRole` / 删除用户前，必须保证操作后**至少还有一个启用状态的 admin**；否则返回 `CONFLICT`，错误信息给出两条出路（先提别人 / 配置 bootstrap 名单）。
- 管理员不能对自己执行 `banUser` / `setUserRole`；`revokeUserSessions`（踢自己下线）允许。
- PostgreSQL 不允许对聚合加 `FOR UPDATE`。用 `pg_advisory_xact_lock(hashtext('admin_console:last_admin'))` 串行化判定，或先 `SELECT id FROM users WHERE role='admin' AND banned=false FOR UPDATE` 再在应用层计数，避免两个管理员并发互撤。
- 恢复路径写进运维文档：数据库直连 `UPDATE users SET role='admin', banned=false WHERE email='...'`。

### 14.3 登录、会话与凭据

- **没有独立的管理员登录页**。管理员与普通用户走同一套登录（SSO_TICKET / 密码 / 邮箱验证码）；`/admin` 在登录后判定，不满足条件按 §14.5 处理。
- **禁用（ban）的语义**（v1 定稿）：

  执行顺序固定为 ① → ② → ③；①② 在控制台事务内，③ 走 Better Auth，不假装原子：

  1. **禁用该用户全部 API Key**：`api_keys.enabled = false`（新增 `ApiKeyModel.disableAllForUser`）；
  2. `users.banned = true` + `banReason` + 可选 `banExpires`；
  3. 尽力撤销该用户全部 Web `session`（Better Auth `revokeUserSessions`）；失败只降级为「该 session 下次鉴权时被 `banned` 拦下」。

  第 1 条是必须的：`validateApiKey` 只检查 key 自身的 `enabled` / `expiresAt`，**不查 `users.banned`**（`packages/trpc/src/lambda/context.ts:40-65`）。只撤 Web 会话时，CLI / API Key 仍能继续调用，等于没禁用。OIDC 路径已有 `assertOIDCUserActive`（同文件 352 行），不受影响。

- **已在执行的运行不强制中断**：禁用后新的 RPC 与工具派发被拒绝；已 running 的 agent 操作按现有看护收敛（与设备撤权一致，§6.6）。
- **解禁不自动恢复 API Key**：key 是一次性凭据，恢复要重建；页面文案写明「解禁后需重新创建 API Key」。
- **v1 不做删除用户**（已确认）：`users` 是设备、审计、会话、内容的归属根；删除要逐表决定 `cascade` / `set null`，且审计 actor 会失去引用。禁用 + 撤凭据已满足「离职即失效」。删除留到 P4，前置条件是审计 actor 快照化（§4.2 的 `actor_name` 已为此准备）。

### 14.4 权限矩阵

| 接口 / 页面 | 未登录 | 普通用户 | 管理员 | 实现 |
| ----------- | ------ | -------- | ------ | ---- |
| `adminConsole.whoami` | 401 | `{isAdmin:false,...}` | `{isAdmin:true,...}` | `authedProcedure`（要能返回「不是管理员」而不是 403） |
| 其余 `adminConsole.*` | 401 | `ADMIN_REQUIRED` | 放行 | `adminProcedure` |
| `device.adminPool.*` | 401 | `ADMIN_REQUIRED` | 放行 | `adminProcedure`（**不是** `deviceProcedure`） |
| `/admin` 前端路由 | 跳登录 | 跳 `/` | 渲染 | 路由 loader 调 `whoami` |

```ts
// packages/business-server/src/adminConsole/procedure.ts
export const adminProcedure = authedProcedure.use(async (opts) => {
  const isAdmin = await assertAdmin(opts.ctx.userId); // 含 §14.2 惰性提权
  if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'ADMIN_REQUIRED' });
  return opts.next();
});
```

- 错误码统一 `ADMIN_REQUIRED`，前端据此显示「需要管理员权限」，不与业务 `FORBIDDEN` 混淆。
- **读接口不放宽**：除 `whoami` 外全部要求 admin；`listUsers` 不做「管理员看全部、普通人看自己」的双语义。
- 管理员豁免：`getHiddenBuiltinModelsForUser` 对 admin 直接返回 `[]`；`withManagedAiWriteGuard` 对 admin 放行（§5.5）。

### 14.5 入口与路由

- 入口只有一处：用户头像菜单（`src/features/User/UserPanel/useMenu.tsx` 的 `settings` 列表）在 `isAdmin` 时插入「管理控制台」项，跳 `/admin`。**不进主侧边栏**。
- `/admin` 在 `src/spa/router/desktopRouter.shared.tsx` 注册（`preloadId: 'adminConsole'`），与设置页同级、不嵌套在 `/settings` 下。
- 前端守卫：路由 loader 读 `whoami`（SWR 缓存 30s），`isAdmin === false` 直接 `redirect('/')`，不渲染 403 页 —— 非管理员不该知道这个路由存在；服务端 `ADMIN_REQUIRED` 才是边界。
- **移动端 v1 不做**：不注册移动路由，手机访问 `/admin` 落到 404。
- 页面外壳复用设置页（`NavPanel` 280px / 44px 页头 / `MAX_WIDTH=1024`），侧栏只渲染当前阶段已交付的入口（§7）。

### 14.6 Better Auth 原生 admin 端点（安全不变量）

`admin()` 插件会随 `toNextJsHandler(auth)` 一并暴露 `/api/auth/admin/{ban-user,set-role,remove-user,revoke-user-sessions,...}`，客户端 `adminClient()` 也已安装。这些端点：

- 不写 `admin_console_audit_logs`；
- `ban-user` **不会禁用 API Key**（§14.3 要堵的洞换个入口仍然存在）；
- `set-role` 绕过「最后一个 admin」保护；
- `remove-user` 直接违反「v1 不删除用户」。

**决策**：v1 在 `src/app/(backend)/api/auth/[...all]/route.ts` 的 handler 前拦截 `pathname` 匹配 `/admin/` 的 POST，返回 404，把「账号状态唯一写入口 = `adminConsole.*`」变成可执行的不变量。上线前先确认上游 / 桌面端没有实际调用这些端点（当前 `adminClient()` 只安装、未见调用）；若上游新增使用，改为只放行读接口（`list-users`）。

验收：直接 `POST /api/auth/admin/ban-user` 返回 404；`/admin` 内的禁用仍成功且 `api_keys` 被禁用。

## 15. 端到端链路

四条链路覆盖从「空数据库」到「设备被撤销」的全过程。每条给出触发、写库、缓存、失败态与验收点。

### 15.1 L1 首次部署与提权

```text
运维                          服务                          数据库
 │ 配置 ADMIN_CONSOLE_...      │                             │
 │ docker compose up           │ 迁移 9001                    │ 建表
 │ 登录（SSO / 密码）          │                             │ users.role = user
 │ 打开 /admin                 │                             │
 │                             │ whoami                      │
 │                             │  ├ role != admin            │
 │                             │  ├ 读 env 名单              │
 │                             │  ├ 命中 → UPDATE role       │ users.role = admin
 │                             │  ├ 写审计 system:bootstrap  │ audit_logs
 │                             │  └ 返回 isAdmin = true      │
 │ 看到「用户」「审计」两页     │                             │
```

| 现象 | 原因 | 处理 |
| ---- | ---- | ---- |
| `isAdmin=false`、`canBootstrap=true` | env 命中但写库失败 | 查 server 日志；刷新重试（幂等） |
| `canBootstrap=false` | env 未配置，或用户尚未创建 | 配置 env 后重启；先登录一次再访问 |
| 提权成功但菜单没有入口 | 前端 flag 缓存 | 刷新页面（SWR 30s） |
| 提权后仍 403 | 浏览器与 server 不是同一实例 | 确认 `APP_URL` 指向当前部署 |

验收：全新库 → 配 env → 首次登录 → `/admin` 直接可用；审计里恰好一条 `user.bootstrapAdmin`。

### 15.2 L2 用户治理

```text
管理员                     adminConsole                  Better Auth / DB
 │ 列表 / 搜索               listUsers                     users
 │ 点「禁用」并填原因         banUser
 │                          ├ 事务开始
 │                          ├ UPDATE api_keys SET enabled = false
 │                          ├ UPDATE users.banned = true
 │                          ├ count(admin AND NOT banned) ≥ 1 ？否 → CONFLICT 回滚
 │                          ├ 提交
 │                          ├ revokeUserSessions（尽力；失败由 banned 兜底）
 │                          └ audit(user.ban, before/after)
 │                          → 返回 { sessions, apiKeys }
```

- 撤销管理员走同一套检查：操作后必须仍有启用 admin，且不能改自己。
- 审计只在业务事务**成功提交后**写；审计写入失败只记 error 日志与计数器（§4.2），不回滚业务。
- 撤销管理员（`setUserRole` → `user`）走同一套检查：事务内确认剩余启用 admin ≥ 1，且不能改自己；不改其已有会话（角色在下一次鉴权时读取）；写审计 `user.role`（before/after）；该用户下一次访问 `/admin` 被重定向，管理接口返回 `ADMIN_REQUIRED`。
- 失败态：`CONFLICT`（最后一个 admin / 操作自己）、`NOT_FOUND`（用户不存在）、Better Auth 报错原样透传 message。

### 15.3 L3 AI 托管

```text
管理员                    updateAiConfig               user_settings / 缓存
 │ 改 provider 白名单        │
 │ 改默认模型 / 服务模型      │
 │ 保存                      ├ 校验 expectedUpdatedAt（§5.2.3）
 │                          ├ 校验 defaultModel / 四层 ∈ 白名单（§5.2）
 │                          ├ 写 admin_console_settings.config.ai
 │                          ├ 只对「本次变化的键」做差量传播
 │                          ├ ≤500：事务内更新；>500：asyncTask
 │                          ├ 清本进程策略缓存
 │                          └ audit(ai.update, before/after)
 │
新用户登录                 initNewUserForBusiness
 │                          └ 物化 defaultModel + 四个层级槽位
 │
普通用户开会话             getAiProviderRuntimeState
 │                          └ getHiddenBuiltinModelsForUser → 过滤模型
 │
普通用户改服务模型         updateSettings
 │                          ├ 托管槽位强制改写回管理员值
 │                          └ 白名单外模型 → FORBIDDEN
```

| 失败态 | 语义 |
| ------ | ---- |
| 传播部分失败（>500） | 配置已生效；页面显示未同步人数，重新保存即可重试 |
| 并发保存 | 后提交者 `CONFLICT`，刷新后重试 |
| 改 embedding 层 | 弹二次确认：换模型会让已入库向量失效；`fileEmbedding` 槽位不随层级变化 |
| 关闭托管 | 按 §5.2.1：停止策略，不回收已物化的值 |

### 15.4 L4 设备池

```text
管理员（在目标机器）        服务端                        gateway
 │ lh login                   │                            │
 │ lh device pool register    ├ device.register(pool=admin)
 │                           ├ audit(device.register)
 │ lh connect                 │                            │ 连接登记 (owner, deviceId)
 │                           │                            │
 │ /admin 分配「全员」         ├ grant(audience='all')
 │                           └ audit(device.grant)
 │
普通用户                     │
 │ 设备列表 / ChatInput 选择器 ├ queryGrantedAdminPoolDevices
 │                           └ 按 owner 批量查在线状态
 │ Agent 工具调用              ├ resolveDeviceOwner → owner
 │                           └ executeToolCall(userId = owner)
 │
管理员撤销                   ├ delete grant
 │                           └ audit(device.revoke)
```

| 失败态 | 语义 |
| ------ | ---- |
| 未授权用户直接构造 dispatch | `DEVICE_NOT_FOUND`（不泄露设备存在性，§6.5） |
| 设备离线 | `DEVICE_OFFLINE`（既有语义） |
| owner 已禁用 / 删除 | 连接失效 → `DEVICE_NOT_FOUND`；先按 §6.8 迁移 |
| 撤销后正在跑的工具调用 | 已完成的不回滚，后续调用失败 |
| 设备重启 | 守护进程自动重连；deviceId 不变（同一 userId） |

### 15.5 统一失败码与回滚

| 码 | 出现位置 | 客户端表现 |
| -- | -------- | ---------- |
| `ADMIN_REQUIRED` | 所有管理接口 | 显示「需要管理员权限」，不跳登录（已登录） |
| `CONFLICT` | 最后一个 admin、并发保存 | 提示原因与出路，要求刷新 |
| `PENDING_DEVICE_ENROLLMENT` | `device.adminPool.transferOwner` | 显示新 owner 需要执行的注册命令 |
| `DEVICE_NOT_FOUND` | 派发、设备读取 | 既有文案；池设备不暴露 owner |
| `DEVICE_OFFLINE` | 派发 | 既有文案 |
| `POLICY_MODEL_FORBIDDEN` | `updateSettings` 白名单 | 提示「该模型未对当前账号开放」 |

回滚策略（按阶段）：

- **P1**：代码回滚即可。`admin_console_*` 表保留，不影响主流程（无读路径）。
- **P2**：先把 `enabled` 置 `false`（策略全短路），再回滚代码；物化的三列保留，用户可自行改回。
- **P3**：`devices.pool` 与授权表保留；代码回滚后池设备回到「管理员的个人设备」，其他用户看不到，不产生越权。
- **迁移不回滚**：`9001_admin_console.sql` 只做加法（`IF NOT EXISTS`）；回滚代码不回滚表。

## 16. 设计缺口清单（第六版收敛）

本轮从「部署 → 登录 → 提权 → 治理 → AI 托管 → 设备注册 → 授权 → 派发 → 撤销 / 离职」逐段走查，收敛出下表。状态：**已定**＝本轮写入正文可直接实现；**建议值**＝按现有代码事实给出，实施中可推翻；**待确认**＝需要产品方拍板。

| 编号 | 缺口 | 影响 | 决策 | 落点 | 状态 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| G-01 | 第一个管理员从哪来、env 叫什么、何时触发 | P1 无法启动 | `ADMIN_CONSOLE_BOOTSTRAP_EMAILS` + `_USER_IDS`，`whoami` 惰性提权；条件 = 从未 bootstrap 过 OR 实例无启用 admin | §14.2 | 已定 |
| G-02 | 最后一个管理员被撤销 / 禁用会锁死实例 | 运维事故 | 事务内 count 校验，返回 `CONFLICT` | §14.2 | 已定 |
| G-03 | 管理员入口在哪 | 功能不可发现 | 用户头像菜单，仅 admin 可见；不进侧边栏 | §14.5 | 已定 |
| G-04 | 非管理员直达 `/admin` 的表现 | 体验 / 信息泄露 | 前端重定向首页；服务端 `ADMIN_REQUIRED` | §14.5 | 已定 |
| G-05 | 禁用用户后 CLI / API Key 仍可用 | **禁用形同虚设** | ban 时同时禁用全部 API Key；解禁不恢复 | §14.3 | 已定 |
| G-06 | 禁用后已建立的 Web 会话是否立即失效 | 安全 | 撤全部 session；已运行的 agent 不中断 | §14.3 | 已定 |
| G-07 | 是否支持删除用户 | 范围 | v1 不做，只禁用；P4 再评估 | §14.3 | 已定（已确认） |
| G-08 | `transferOwner` 只改 `devices.userId` 会让设备永久离线 | **P3 核心路径错误** | 两阶段：设备侧重注册 + 服务端迁移 | §6.8 | 已定 |
| G-09 | 池设备注册必须在目标机器上、由管理员登录 CLI | 运维流程缺失 | 写进控制台空态与运维文档；P4 用 enrollment token | §6.2 / §6.8 | 已定 |
| G-10 | 是否禁止普通用户个人注册设备 | 企业语义 | v1 不禁止（池是叠加能力）；强约束留 P4 | §6.2 | 已定（已确认） |
| G-11 | 授权对象怎么解析（工号 / 邮箱 / 用户名） | 授权失败率高 | email 精确匹配 + username 精确匹配；批量时逐条返回未找到项 | §6.3 | 已定 |
| G-12 | 多个用户同时用一台池设备 | 数据互相干扰 | v1 允许并发，不做互斥 | §6.9 | 已定（已确认） |
| G-13 | 池设备显示名来源 | 用户认不出设备 | `friendlyName` 由管理员设置，用户只读 | §6.9 | 已定 |
| G-14 | 关闭托管后已物化的配置不回滚 | 与旧文案矛盾 | 收窄 `enabled` 语义为「策略是否生效」，不回收数据 | §5.2.1 | 已定 |
| G-15 | 传播部分失败 / 大事务 | 数据半状态 | ≤500 单事务；>500 后台分批 + 失败计数 | §5.2.2 | 已定 |
| G-16 | 两个管理员并发保存 | 静默覆盖 | `updated_at` 乐观锁，`CONFLICT` | §5.2.3 | 已定 |
| G-17 | 改 embedding 层会让已入库向量失效 | 检索质量 | 二次确认 + `fileEmbedding` 不托管 | §15.3 | 已定 |
| G-18 | 策略缓存多副本一致性 | 配置延迟 | 进程内 5s，单实例可接受；多副本改 Redis 版本号 | §5.4 | 建议值 |
| G-19 | 审计能否导出、保留多久 | 合规 | 永久保留，v1 不导出 | §13.3 | 建议值 |
| G-20 | 管理端数据获取 / store 结构未定义 | 前端实现 | 复用 SWR + `src/services/adminConsole.ts`，不新建全局 store | §9.1 | 建议值 |
| G-21 | 移动端是否可用 `/admin` | 范围 | v1 只做桌面，移动端 404 | §14.5 | 已定 |
| G-22 | API Key 鉴权不查 `users.banned` 的事实未登记 | 上游变更风险 | 列入 §11 检查点第 16 条 | §11 | 已定 |
| G-23 | SSO `roleCodes` 与 v1 提权的关系 | P4 衔接 | v1 只认 `users.role`；P4 由 SSO 映射，bootstrap 名单保留为兜底 | §10 P4 | 建议值 |
| G-24 | 池设备与 hetero / MCP tunnel / workspace 的边界 | 误派发风险 | v1 fail closed，返回 `DEVICE_NOT_FOUND` | §6.5 / §6.7 | 已定 |
| G-25 | 池设备上的并发写 / 端口冲突 | 使用体验 | 平台不猜，交给使用约定；文档写明 | §6.9 | 建议值 |
| G-26 | 审计写入失败是否影响业务 | 一致性 | 只 log，不回滚 | §4.2 | 已定 |
| G-27 | 管理员账号交接 / 离职 | 运维 | 先迁移设备 owner 与授权，再撤销 admin / 禁用 | §6.8 / §14.3 | 已定 |
| G-28 | bootstrap 名单会让「撤销管理员」在下次访问时自动回滚 | 止血动作失效 | 提权条件 = 「从未 bootstrap 过」OR「实例无启用 admin」；两边都保留 | §14.2 | 已定 |
| G-29 | Better Auth 原生 `/api/auth/admin/*` 绕过控制台守卫 | 禁用 / 降级 / 删除 / 审计全部绕过 | 路由层拦截这些 POST；账号状态唯一写入口 = `adminConsole.*` | §14.6 | 已定 |
| G-30 | `listDevices` 把 owner / `defaultCwd` / `workingDirs` / `metadata` 下发给被授权用户 | 隐私泄露 | 池设备走裁剪投影，用户侧 payload 不含 owner | §6.4 | 已定 |
| G-31 | 每次保存 AI 配置都会重置所有用户的模型选择 | 日常行为被打断 | 按变更键差量传播；白名单 / menu 变化不写用户列 | §5.2 | 已定 |
| G-32 | `defaultModel` / 四层槽位可能落在白名单外 | 会话直接失败 | 保存前校验；移除在用模型返回影响面并要求 `force` | §5.2 | 已定 |
| G-33 | 菜单开关在 §4.1 与 §5.6 是两套存储 | 实现二选一失效 | 统一 `config.menu` + `updateMenuPolicy` | §5.6 / §8 | 已定 |
| G-34 | 管理员从设置页改 provider / Key 不产生审计；审计失败不可见 | 合规缺口 | `withManagedAiWriteGuard` 放行 admin 时写审计；失败 `console.error` + 计数 | §4.2 / §5.5 | 已定 |
| G-35 | owner 解析给每次个人设备派发加一次库读 | 热路径成本 | 先判是否池设备，命中才查；缓存按 run 实例 | §6.5 / §6.9 | 已定 |
| G-36 | `getScopedOnlineDevices` 全局带池设备会让 MCP tunnel 等先列出后失败 | 回归面被低估 | `includePoolDevices` 默认 `false`，只在两处显式打开 | §2 / §6.4 | 已定 |

**本轮确认的三项**：G-07 不做删除用户、G-10 不禁止普通用户个人注册设备、G-12 允许池设备并发。三项已写入正文（§14.3、§6.2、§6.9），本版**无剩余待确认项**。

