# 管理员控制台（CUST-008）设计方案

> 状态：P1（用户管理）已实现并通过本地验收（2026-11-23，分支 `feat/admin-console-p1`，实施偏差见 §15）；P2（模型服务）仍为设计，未开工。审计日志不做。原型见 `prototypes/admin-console/`。

## 1. 范围

| 能力                    | 用户可见结果                                                                                     | 阶段           |
| ----------------------- | ------------------------------------------------------------------------------------------------ | -------------- |
| **用户管理**            | `/admin` 用户列表、搜索、详情、禁用 / 启用、设 / 撤管理员、会话失效                              | P1，可单独上线 |
| **模型服务（Tellhow）** | 管理员维护公司网关地址、密钥与模型目录；用户在设置里看到一个常驻已启用的内置服务商，自己勾选模型 | P2             |

接口与页面互不依赖：P1 交付后即可作为企业账号后台使用，`/admin` 只渲染已交付的入口。P2 复用 P1 建好的单行配置表 `admin_console_settings`，所以在 P1 之后开工。

## 2. 现状与关键发现

| 事实                                                                                                                                                                                                                                                    | 位置                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Better Auth `admin()` 已启用，`adminClient()` 已安装                                                                                                                                                                                                    | `src/libs/better-auth/define-config.ts:320`                                                          |
| 服务端厂商配置由 `genServerAiProvidersConfig()` 组装，产出 `enabled` / `enabledModels` / `serverModelLists` / `fetchOnClient`                                                                                                                           | `apps/server/src/globalConfig/genServerAiProviderConfig.ts`                                          |
| 模型请求解析时，若 provider ∈ `ModelProvider`、`runtimeProvider` 缺省或等于 provider、且 payload 不带 `baseURL` / `cloudflareBaseURLOrAccountID`，会用部署级密钥 `<PROVIDER>_API_KEY` 与 `<PROVIDER>_PROXY_URL`（`canUseServerProviderConfig`，`:215`） | `apps/server/src/modules/ModelRuntime/index.ts`（`getParamsFromPayload`，`:229`）                    |
| `lobehub` 厂商是「用户不可配置、只能挑模型」的现成范式：`showConfig: false`、`modelEditable: false`、`showModelFetcher: false`                                                                                                                          | `packages/model-bank/src/modelProviders/lobehub.ts`                                                  |
| 模型类型枚举（按代码顺序）：`chat / embedding / tts / asr / image / video / text2music / realtime / decision`                                                                                                                                           | `packages/model-bank/src/types/aiModel.ts:21`                                                        |
| 厂商枚举                                                                                                                                                                                                                                                | `packages/model-bank/src/const/modelProvider.ts`                                                     |
| 设置页外壳：`NavPanel` 240–400px 可拖拽（默认 280）、`NavHeader` 高度取密度 token、`SettingContainer` `maxWidth=1024`                                                                                                                                   | `src/features/NavPanel`、`src/features/Settings/Layout`、`src/features/Setting/SettingContainer.tsx` |
| 界面密度两档：loose 正文 14/22、控件 32、列表行 48、圆角 8；compact 正文 13/20、控件 28、列表行 40、圆角 6                                                                                                                                              | `src/styles/densityScale.ts`                                                                         |
| 出站请求 SSRF 策略：用户 / 厂商可控 URL 统一走 `ssrfSafeFetch`，内网地址需 `SSRF_ALLOW_PRIVATE_IP_ADDRESS=1` 或 `SSRF_ALLOW_IP_ADDRESS_LIST`                                                                                                            | `packages/ssrf-safe-fetch/index.ts`、`packages/model-runtime/src/utils/ssrfFetch.ts`                 |

**关键结论**

1. Tellhow 只是一个内置 provider，不需要改 `aiProvider` / `aiModel` 的写入面。
2. 现有运行时已支持「provider 属于枚举且请求不带 baseURL 时使用部署级凭据」；把凭据来源换成控制台配置即可，客户端拿不到 Key。
3. 控制台只写 `admin_console_settings.config.ai`，不写任何用户的 `user_settings`。
4. 用户自己的模型开关属于用户行，不是控制台传播。

## 3. 总体设计

```text
/admin
 ├─ 用户管理   → Better Auth admin() + 列表摘要查询（P1）
 └─ 模型服务   → admin_console_settings.config.ai（P2）
    ├─ 服务连接：baseURL + API Key（加密）+ 测试连接
    ├─ 模型目录：类型 / 上下文 / 能力 / 是否对全员开放
    └─ 默认值（可选）：新用户默认模型与系统任务模型
```

## 4. 数据模型

### 4.1 `admin_console_settings`（单例）

```ts
type AdminConsoleSettings = {
  id: 'singleton';
  config: {
    ai?: {
      enabled: boolean;
      baseURL: string;
      apiKey: {
        ciphertext: string; // KeyVault 加密后的密文
        last4: string;
        updatedAt: string;
        updatedBy: string;
      } | null;
      models: CompanyModel[];
      defaults?: {
        chat?: string;
        embedding?: string;
        title?: string;
        verify?: string;
      };
      lastTest?: {
        at: string;
        ok: boolean;
        latencyMs?: number;
        modelCount?: number;
        errorCode?: string;
      };
    };
  };
  updatedAt: string;
  updatedBy: string;
};

type CompanyModel = {
  id: string; // 请求体里的 model
  name: string; // 用户侧显示名
  type: AiModelType; // 9 种类型之一
  contextWindowTokens?: number;
  capabilities?: Array<'vision' | 'functionCall' | 'reasoning'>;
  open: boolean; // 是否出现在用户侧
  source: 'sync' | 'manual';
  pending?: boolean; // 待确认
  removedAt?: string; // 上游已移除，不自动删除
};
```

约束：单行 `config` jsonb；密钥只存密文，接口返回时替换为 `last4`；模型 `type` 必须属于 `AiModelType`，保存时校验。

### 4.2 迁移

`9001_admin_console.sql` 只建一张表（settings），`IF NOT EXISTS`，可重复执行。

审计日志本轮不做：不建表、不留占位接口，后续补时再单独加迁移与页面。

## 5. 模型服务（Tellhow 企业内置厂商）

### 5.1 用户看到什么

- Tellhow 在「AI 服务商」里常驻已启用，不需要填 Key，也没有配置入口；
- 右侧模型列表由公司目录决定：管理员 `open: true` 的模型才出现；
- 用户可勾选启用 / 停用某个模型，也可以继续添加其他厂商；
- 用户看不到、也不能改服务地址与密钥，不能删除这个厂商；
- 管理员关闭 `enabled` 后，用户侧不再出现该厂商；已选过它的会话下一次请求收到可读错误。

### 5.2 服务连接与凭据

- 服务地址：OpenAI 兼容 baseURL，保存后下一次请求生效；
- 访问密钥：管理员在 Tellhow 网关生成后粘贴，随「保存配置」提交；页面只回显末四位与上次更新时间；
- 控制台不生成密钥、不提供轮换；
- 安全不变量：
  1. 非管理员接口不返回明文或密文；
  2. 用户侧 `getAiProviderRuntimeState` 对 Tellhow 不回传 `keyVaults`；
  3. 所有模型请求经服务端转发（`fetchOnClient = false`）。
- 测试连接：用已保存的密钥请求一次 `/models`，只回显状态、延迟、可用模型数与错误码；
- 出站策略：这是「管理员配置的服务器地址」，但仍属于服务端出站请求。按当前仓库约定走 `ssrfSafeFetch`，并为本条地址显式传入放行选项（企业的 Tellhow 网关通常是内网地址），不通过 `SSRF_ALLOW_PRIVATE_IP_ADDRESS=1` 全局放开；
- 用户消息里的远程图片等媒体下载已由 `packages/model-runtime/src/utils/imageToBase64.ts` 走 SSRF 策略，控制台不需要重复实现。

### 5.3 运行时注入

只对 `tellhow` 生效，优先级：

```text
控制台配置 > 环境变量（TELLHOW_API_KEY / TELLHOW_PROXY_URL）> 未配置则报 PROVIDER_NOT_CONFIGURED
```

接点：

- `packages/business-server/src/companyProvider.ts` 新增 `getCompanyProviderRuntime()`，读配置并做 5s 进程内缓存；
- `apps/server/src/modules/ModelRuntime/index.ts` 默认分支插入业务层凭据；`getParamsFromPayload` 保持同步，不改签名（一处调用点）；
- `apps/server/src/globalConfig/index.ts` 把控制台模型目录合并进 `aiProvider.tellhow.serverModelLists`；
- `canUseServerProviderConfig()` 不变。

保存后清本进程缓存；多副本一致性留到需要时改 Redis 版本号。

### 5.4 模型目录

列表列：模型（显示名 + id）、类型 + 能力、上下文、对全员开放、操作。

类型以 `AiModelType` 为准，共 9 种。视觉理解是对话模型的能力，不是类型。

从服务拉取：

1. 用已保存的密钥请求 `/v1/models`；
2. 上游通常只返回 `id` / `owned_by` / `created`，按命名规则推断类型：

| 规则                                       | 类型                   |
| ------------------------------------------ | ---------------------- |
| `embed / bge / gte / text-embedding`       | 向量化                 |
| `music / suno / melody / text2music`       | 音乐                   |
| `tts / speech / voice`                     | TTS                    |
| `whisper / asr / stt / transcribe / audio` | ASR                    |
| `dall-e / flux / diffusion / image / sd-`  | 图片                   |
| `video / sora / veo / kling`               | 视频                   |
| `realtime` / `decision`                    | 实时 / 决策            |
| 其余（含 `vl / vision / multimodal`）      | 对话（视觉能力待确认） |

3. 命中仓库已有模型目录时带出显示名、上下文与能力；未命中的标「待确认」，由管理员补；
4. 弹窗里每个模型都可改类型后再导入。

同步策略：

- 新增默认 `open: false`、`pending: true`；
- 已存在的只更新元数据，不改 `open`；
- 上游消失的不自动删除，标「上游已移除」；确认无人使用后手动移除；
- 手工添加字段与同步模型一致。

### 5.5 默认值（可选）

只影响新用户创建时的初始值，不写存量用户：

- 新用户默认对话模型；
- 记忆 / 知识库向量模型（换模型需重新索引，文案明示）；
- 标题生成 / 历史压缩、任务校验。

实现落点是 `initNewUserForBusiness` 的一次写入，失败不阻塞登录。不配置时沿用现有默认值。

### 5.6 失败与回滚

| 场景             | 行为                                            |
| ---------------- | ----------------------------------------------- |
| 密钥无效 / 过期  | `PROVIDER_AUTH_FAILED`，不泄露上游响应体        |
| 网关不可达       | `PROVIDER_UNREACHABLE`，保留上一次成功配置      |
| 未配置地址或密钥 | `PROVIDER_NOT_CONFIGURED`，用户侧不出现 Tellhow |
| 关闭 `enabled`   | 用户侧立即不可见；下一次请求提示切换模型        |
| 并发保存         | `updated_at` 乐观锁，后提交者 `CONFLICT`        |
| 回滚             | 代码回滚即可，用户设置不受影响                  |

## 6. 管理端界面

### 6.1 页面与导航

独立路由组 `/admin`，**不复用设置页的 `:tab` 路由**：设置页的 `:tab` 由 `SettingsContent` 按 `componentMap` 分发，且语义是「当前用户的偏好」；管理控制台是另一套权限与导航，混进去会让设置页被迫加载管理员代码。

复用的部分：

- `NavPanelPortal navKey="admin"` + `SideBarLayout`：侧栏结构、折叠、拖拽（240–400px）与设置页一致；
- `NavHeader`：顶栏三槽，高度取密度 token；
- `SettingContainer maxWidth={1024}`：正文列宽与设置页一致；
- 分组导航参考 `useCategory` 的呈现方式（控制台自己的配置，不复用该 hook）：单个分组「管理」，顺序 `用户管理 → 模型服务`。

不复用的部分：路由表、`componentMap`、设置页的搜索作用域；`/admin/*` 只注册在 `desktopRouter.shared.tsx`，移动端不注册。

用户侧服务商页（P2）不在 `/admin` 内，它属于产品设置：原型按真实的 `src/features/Settings/provider` 实现三列 —— 设置侧栏 / 服务商菜单（280，搜索、可折叠分组、启用绿点、底部统计）/ 内容区（已启用与未启用卡片网格）。泰豪 AI 在已启用首位，详情不展示密钥与代理配置，只有说明 + 模型列表，并跟随管理端「对全员开放」。

### 6.2 视觉规范（对齐 `densityScale.ts`）

两档密度由「设置 → 外观 → 界面密度」决定，控制台不另造一套数字：

| token          | loose（默认） | compact |
| -------------- | ------------- | ------- |
| 正文 / 行高    | 14 / 22       | 13 / 20 |
| 页头高度       | 44            | 40      |
| 控件高度       | 32            | 28      |
| 列表行高       | 48            | 40      |
| 圆角           | 8             | 6       |
| 页面左右内边距 | 24            | 16      |
| 页面顶部内边距 | 32            | 24      |
| 分组间距       | 16            | 12      |
| 工具栏高度     | 40            | 36      |

固定不随密度变化的：

- 内容列宽 `1024`、设置页底部留白 `128`（与 `SettingsContent` 一致）；
- 标题层级：顶栏标题用正文级 14/13；内容区区块标题取 `pageTitleFontSize`（16/14）；抽屉内小标题 12；不使用 `SettingHeader` 的 20/24 大标题；
- 状态标签用 `tag-success` / `tag-danger` / `tag-warning`，复用 `@lobehub/ui` 的 Tag（22px 高 / 12px 字），不自定义高度；
- 页面标题只由顶栏绘制，内容区不重复 H1；
- 列表：小号列头 + `listRowHeight` 行高 + 1px 发丝线 + hover 填充，不用带边框的表格；
- 空态：标题 + 说明 + 「清除筛选」；
- 可点击行支持 Enter / 空格与 `focus-visible`。

### 6.3 两页结构

- **用户管理**：搜索、筛选（全部 / 管理员 / 已禁用）；行 = 头像 + 姓名 / 邮箱、工号、角色、状态、最后活跃、chevron；点行开 520px 详情抽屉（概览 / 操作）；
- **模型服务**：服务连接、模型目录（拉取 + 手工添加 + 编辑弹窗）、默认值（可选）。

### 6.4 与最新代码的对齐（v8 记录）

第七版写作时密度系统尚未落地，视觉规范按 36px 控件、固定 14/22 正文硬编码。第八版逐条核对当前代码后修正：

| 项         | v7                          | v8（核对结果）                                                                                               |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 控件高度   | 36                          | 32 / 28（密度 token）                                                                                        |
| 列表行高   | 12px 内边距                 | 48 / 40（`listRowHeight`）                                                                                   |
| 正文字号   | 固定 14/22                  | 14/22 或 13/20，跟随密度                                                                                     |
| 圆角       | 输入 6 / 按钮 8             | 统一 `radius` 8 / 6（输入框用 `radius-sm`）                                                                  |
| 侧栏       | 固定 280                    | 240–400 可拖拽，默认 280                                                                                     |
| 页面内边距 | 24                          | 24/32（loose）、16/24（compact）                                                                             |
| 标题层级   | 14 固定                     | 顶栏 14/13（正文级）、区块标题 `pageTitleFontSize` 16/14、抽屉小标题 12                                      |
| 出站请求   | 未涉及                      | 控制台「测试连接」与厂商网关的媒体下载走 `ssrfSafeFetch`；内网网关需在部署侧加白名单，不全局放开私有 IP      |
| 运行时接点 | `getParamsFromPayload` 同步 | 仍为同步 `apps/server/src/modules/ModelRuntime/index.ts:229`；已取消「改 async」计划，改为在默认分支注入凭据 |

原型右上角的「密度」按钮即用于演示 loose /compact 两档。

### 6.5 为什么不做成设置页的一个 Tab

- 设置页的守卫是「登录即可」，管理控制台是「`users.role='admin'`」；
- 设置页 `componentMap` 会被非管理员加载，等于把管理员页面的 chunk 发给所有人；
- 设置页的导航是用户偏好（外观、语言、模型），控制台是治理动作（禁用、改角色），分组语义不同；
- 独立路由更利于 `preloadId: 'adminConsole'` 的按需预加载与权限前置。

## 7. 后端接口

`apps/server/src/routers/lambda/adminConsole/`，在 `routers/lambda/index.ts` 挂一行：

| 接口                         | 入参                                                                     | 作用                                                                       |
| ---------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `whoami`                     | —                                                                        | `{ isAdmin, role, canBootstrap, bootstrapConfigured }`；命中名单时惰性提权 |
| `listUsers`                  | `{ q?, role?, status?, page, pageSize }`                                 | 分页 + 搜索，默认 20 / 页                                                  |
| `getUser`                    | `{ userId }`                                                             | 账号、角色、banned、最近活跃                                               |
| `setUserRole`                | `{ userId, role }`                                                       | 撤销最后一个 admin / 改自己 → `CONFLICT`                                   |
| `banUser`                    | `{ userId, reason, expiresAt? }`                                         | 禁用 API Key + 设 banned + 尽力撤 session                                  |
| `unbanUser`                  | `{ userId }`                                                             | 清 banned；不恢复 API Key                                                  |
| `revokeUserSessions`         | `{ userId }`                                                             | 只撤 Web 会话                                                              |
| `getModelServiceConfig`      | —                                                                        | 返回配置；密钥只返回 `last4`                                               |
| `updateModelServiceConfig`   | `{ enabled, baseURL?, apiKey?, models?, defaults?, expectedUpdatedAt? }` | 校验后写配置，无传播                                                       |
| `testModelServiceConnection` | —                                                                        | 请求 `/models`，返回状态 / 延迟 / 模型数 / 错误码                          |
| `refreshModelCatalog`        | `{ apply: boolean }`                                                     | 拉取并返回 diff；`apply` 时写入新增模型                                    |

全部使用 `adminProcedure`；`whoami` 用 `authedProcedure`。

## 8. 对现有代码的侵入清单

### 8.0 最小侵入原则（开发时按此执行）

1. **加法优先**：能新增文件就不改共享文件；必须改的共享文件只做「注册 / 接线 / 枚举追加」，不改既有分支行为。
2. **不碰上游数据模型**：不新增列、不改 `users` / `user_settings` / `aiProvider` / `aiModel` 的结构；账号状态只用 Better Auth 已有的 `role` / `banned` / `banReason` / `banExpires`。控制台自己的配置只写单行表 `admin_console_settings`。
3. **单点接线**：路由、菜单入口、provider 枚举各一处，不散落到多个模块。
4. **业务边界**：业务逻辑只写在 `packages/business-server/src/adminConsole/*`、`apps/server/src/routers/lambda/adminConsole/*`；UI 只写在 `src/features/AdminConsole/*`；其他模块只依赖它对外的导出。
5. **不复制上游组件**：复用 `NavPanel` / `NavHeader` / `SettingContainer` / `UserPanel` 的既有结构；`/admin` 按独立路由组的约定接入，不套用设置页的 `componentMap`（那是用户偏好），也不 fork 一套外壳。用户侧服务商页是反例：手写一套会立刻偏离真实页面。
6. **默认关闭、可回滚**：未配置时 Tellhow 不出现在用户侧；回滚只需回代码，配置行保留但不读取，不要求数据回滚。
7. **不改变上游语义**：不改 `settingsRouter.updateSettings`、不动 `featureFlags`、不启用 Better Auth 原生 `/api/auth/admin/*`。
8. **迁移隔离**：fork 迁移固定在 9000+ 保留区，用 `bun run db:fork:reconcile` 维护；不手改上游迁移与快照链。
9. **可审查**：PR 必须附 `git diff --stat` 的共享文件清单，逐项对照 8.2；新增文件单独列出，不计入预算。

**侵入预算**

| 类别     | 预算                                               |
| -------- | -------------------------------------------------- |
| 新增文件 | 不限，但必须落在 8.1 的目录内                      |
| 共享文件 | 8 个（见 8.2），每处 ≤ 10 行；超出需在 PR 写明理由 |
| 数据库   | 1 张新表；0 个上游表结构变更                       |
| 路由     | 1 条 `/admin`                                      |
| 上游测试 | 不修改；确需修改时单独说明                         |

### 8.1 新增（Fork 自有）

```text
packages/model-bank/src/modelProviders/tellhow.ts
packages/model-bank/src/aiModels/tellhow.ts
packages/business-server/src/companyProvider.ts
packages/business-server/src/adminConsole/modelService.ts
packages/types/src/adminConsole.ts
apps/server/src/routers/lambda/adminConsole/*
src/features/AdminConsole/*
src/services/adminConsole.ts
```

### 8.2 必须改的共享文件（每处 ≤ 10 行）

| 文件                                              | 改动                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/model-bank/src/modelProviders/index.ts` | 导出 tellhow provider                                             |
| `packages/model-bank/src/aiModels/index.ts`       | 导出 tellhow 模型目录                                             |
| `packages/model-bank/src/const/modelProvider.ts`  | `ModelProvider` 追加 `tellhow`                                    |
| `apps/server/src/modules/ModelRuntime/index.ts`   | 默认分支注入业务层凭据；`getParamsFromPayload` 保持同步、不改签名 |
| `apps/server/src/globalConfig/index.ts`           | 合并 tellhow 模型目录                                             |
| `apps/server/src/routers/lambda/index.ts`         | 挂 `adminConsole`                                                 |
| `src/spa/router/desktopRouter.shared.tsx`         | 注册 `/admin`，`preloadId: 'adminConsole'`                        |
| `src/features/User/UserPanel/useMenu.tsx`         | 管理员菜单入口                                                    |

共 8 个共享文件。SSRF 只在上面的新文件里调用 `ssrfSafeFetch`，不修改 `packages/ssrf-safe-fetch` 本身。

### 8.3 刻意不改

- `aiProvider` / `aiModel` 的任何 mutation；
- `settingsRouter.updateSettings` 与设置策略；
- `featureFlags`（不新增全局开关）；
- `getServerGlobalConfig` 的默认值链（除 tellhow 目录合并外）；
- 上游 `packages/database/migrations/*`（只维护 fork 自己的 `9000_snapshot`）；
- `src/features/Settings/**` 的现有页面。

## 9. 分阶段

### P0 设计（本版）

设计文档 + 原型，等待产品方确认后进入 P1。

### P1 用户管理

1. `9001_admin_console.sql` 一张表 + model（fork 保留区 9001，生成后跑 `db:fork:reconcile`）；
2. `adminConsole` router + 挂载；
3. `ADMIN_CONSOLE_BOOTSTRAP_*` 惰性提权；
4. `adminProcedure` 与防锁死；
5. 禁用级联：撤 session + 禁用 API Key；
6. `/admin` 路由 + 守卫 + 用户页。

顺序：1 → 4 → 3 → 5 → 2 → 6。

### P2 模型服务

1. model-bank 的 tellhow provider 与枚举；
2. `config.ai` 结构 + 密钥加密（复用 P1 的表，不再新建迁移）；
3. `companyProvider` 读取与缓存；
4. 运行时注入（密钥 / 地址 / 模型目录）；
5. 测试连接与目录同步；
6. `/admin` 模型服务页；
7. 用户侧联调：首登可选模型、自建厂商不受影响、抓包无密钥。

顺序：1 → 2 → 3 → 4 → 5 → 6 → 7。

## 10. 上游合并检查点

1. `canUseServerProviderConfig` 是否仍以 `ModelProvider` 枚举、`runtimeProvider` 一致、payload 不带 `baseURL` / `cloudflareBaseURLOrAccountID` 作为服务端凭据条件；
2. `genServerAiProvidersConfig` 的 `serverModelLists` 语义是否变化；
3. `AiModelType` 是否新增类型；
4. `lobehub` 厂商的 `showConfig` / `modelEditable` 是否变化；
5. `getServerGlobalConfig` 是否新增默认值来源；
6. 设置页列表 / Form 的 token 是否变化；
7. `src/styles/densityScale.ts` 是否新增 token 或改动两档数值，控制台视觉规范随之更新；
8. `ssrfSafeFetch` 的选项与默认策略是否变化（企业内网网关的白名单方式）。

## 11. 验收清单

**P1**

- [ ] 管理员能搜索、禁用用户；禁用后 API Key 立即 401，重新登录被拒；已在线会话尽力撤销；
- [ ] 设 / 撤管理员立即生效；撤销最后一个 admin / 禁用自己 → `CONFLICT`；
- [ ] 非管理员访问 `/admin/*` 返回 `ADMIN_REQUIRED`，直达 URL 重定向首页；
- [ ] 配置 `ADMIN_CONSOLE_BOOTSTRAP_EMAILS` 后，首次访问 `/admin` 成为管理员。

**P2**

- [ ] 用户首次登录，设置 → AI 服务商里看到「泰豪 AI」已启用，无需填 Key；
- [ ] 管理员开放的模型出现在用户模型列表；关闭后刷新即消失；
- [ ] 用户可自建其他厂商并正常对话；
- [ ] 抓包 / 接口响应中不出现明文或密文密钥；
- [ ] 管理员改地址或密钥后新请求生效；测试连接返回状态、延迟与模型数；
- [ ] 目录同步新增默认不开放并标「待确认」；上游移除不自动删除；
- [ ] 关闭 `enabled` 后用户侧不可见，下一次请求给出可读错误；
- [ ] 保存配置前后 `user_settings` 三列无变化；

**工程**

- [ ] `bun run type-check` 退出码 0（`tsrs` 跑 `tsconfig.type-check.json`）；
- [ ] 改动文件 oxlint 0 error；
- [ ] 共享文件 diff 符合 §8.2 预算（每处 ≤ 10 行，超出有说明）；上游迁移与设置页未被改动；
- [ ] 单测覆盖：密钥加解密与脱敏、目录 diff 与类型校验、运行时凭据优先级、adminProcedure、防锁死；
- [ ] 上游合并演练按第 10 节逐条复查并记录到 `CUSTOMIZATIONS.md`。

## 12. 管理员身份与引导链路

### 12.1 身份判定

| 事实                                                                                        | 位置                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `users.role` 是可空 `text`；admin 插件要求的 `banned` / `banReason` / `banExpires` 已在表里 | `packages/database/src/schemas/user.ts:38-43`    |
| Better Auth `admin()` 已注册                                                                | `src/libs/better-auth/define-config.ts:320`      |
| 开工前核查（2026-11-20）：实例用户 `role` 均为 `user` / `NULL`，尚无管理员                  | 运行时快照，仅说明需要 bootstrap，不作为设计前提 |

```ts
export const isAdminRole = (role: string | null | undefined) => role === 'admin';
```

不新增 `is_admin` 列；`role` 为 `null` / 空串按 `user` 处理。

### 12.2 首次提权：`ADMIN_CONSOLE_BOOTSTRAP_*`

| 方案              | 结论 |
| ----------------- | ---- |
| 手工 SQL          | 兜底 |
| 固定初始密码      | 不做 |
| 邮箱 / 用户名名单 | 采用 |

```bash
ADMIN_CONSOLE_BOOTSTRAP_EMAILS="admin@tellhowsoft.com,ops@tellhowsoft.com"
ADMIN_CONSOLE_BOOTSTRAP_USER_IDS=""
```

规则：

1. 触发点只有 `adminConsole.whoami` 与 `adminProcedure`；
2. 命中 `user.id`、`lower(email)` 或 `lower(username)`；
3. 只升不降：当前不是 admin，且满足「实例无启用 admin」或「从未 bootstrap 过」时写 `role='admin'`；
4. 名单移除后不自动降权；
5. 未配置时 `canBootstrap=false`，页面提示配置方式。

防锁死：

- 操作后必须仍有至少一个启用 admin，否则 `CONFLICT`；
- 管理员不能禁用 / 改自己的角色；踢自己下线允许；
- 用 `pg_advisory_xact_lock(hashtext('admin_console:last_admin'))` 串行化并发判定；
- 恢复路径：数据库直连改 `role` / `banned`。

### 12.3 登录、会话与凭据

- 与普通用户同一套登录；
- 禁用顺序：① 禁用全部 API Key → ② 写 `banned` → ③ 尽力撤 Web 会话；
- 第 ① 步必须做：`validateApiKey` 不检查 `users.banned`（`packages/trpc/src/lambda/context.ts:42-68`）；
- 已在执行的运行不强制中断；
- 解禁不恢复 API Key；
- v1 不删除用户。

### 12.4 权限矩阵

| 接口 / 页面           | 未登录 | 普通用户             | 管理员              |
| --------------------- | ------ | -------------------- | ------------------- |
| `adminConsole.whoami` | 401    | `{ isAdmin: false }` | `{ isAdmin: true }` |
| 其余 `adminConsole.*` | 401    | `ADMIN_REQUIRED`     | 放行                |
| `/admin` 前端路由     | 跳登录 | 跳 `/`               | 渲染                |

### 12.5 入口与路由

- 入口：产品侧栏**左上角**的用户头像（`src/features/HomeSidebar/Header/components/User.tsx` → `UserPanel` → `PanelContent`）菜单；
- 菜单结构与现有 `UserPanel` 保持一致，不另造一套：身份区（头像 + 名称 + 邮箱）→ 统计卡（助手 / 话题 / 消息 + 升级）→ 业务槽位与工作区切换（本轮不改）→ 菜单（**管理控制台** / 应用设置 / 获取应用）→ 退出登录；
- 插入点：`src/features/User/UserPanel/useMenu.tsx` 的 `mainItems`，紧随开头 divider、在 `settings` 之前；`isAdmin` 时插入，label 带「管理员」标签；非管理员不渲染；
- 原型 `index.html` 默认展示产品首页，点击左上角头像打开菜单，再点「管理控制台」进入 `/admin`；右上角「入口演示」可回放；
- `/admin` 注册在 `desktopRouter.shared.tsx`，`preloadId: 'adminConsole'`；
- 前端守卫读 `whoami`，非管理员 `redirect('/')`；
- 移动端不注册路由。

### 12.6 Better Auth 原生 admin 端点

`/api/auth/admin/*` 会绕过控制台的禁用 / 改角色、API Key 禁用与最后管理员保护。v1 在 `src/app/(backend)/api/auth/[...all]/route.ts` 拦截 `POST /admin/*` 返回 404，使「账号状态唯一写入口 = `adminConsole.*`」成立。

## 13. 端到端链路

### 13.1 L1 首次部署与提权

```text
运维                     服务                       数据库
 │ 配置 ADMIN_CONSOLE_*   │                          │
 │ docker compose up      │ 迁移 9001                │ 建表
 │ 登录                   │                          │ users.role = user
 │ 打开 /admin            │ whoami                   │
 │                        │ ├ 命中 env 名单          │
 │                        │ ├ UPDATE role = admin    │
 │ 看到用户管理           │                          │
```

### 13.2 L2 用户治理

```text
管理员                     adminConsole                  Better Auth / DB
 │ 禁用并填原因              banUser
 │                          ├ 事务：禁用 API Key
 │                          ├ 事务：banned = true
 │                          ├ 校验剩余启用 admin ≥ 1
 │                          ├ 提交
 │                          └ revokeUserSessions（尽力）
```

### 13.3 L3 模型服务

```text
管理员                     控制台                        用户侧
 │ 填地址 / 密钥             updateModelServiceConfig
 │ 测试连接                  ├ 请求 /models
 │                          └ 写 config.ai + 清缓存
 │
 │ 拉取模型                  refreshModelCatalog
 │                          ├ 规则推断类型
 │                          └ 返回 diff；确认后写入
 │
 普通用户                    ModelRuntime
 │ 选模型发消息               ├ 无本地 key / baseURL
 │                          ├ 业务层注入控制台凭据
 │                          └ 请求 Tellhow 网关
```

| 失败态     | 语义                      |
| ---------- | ------------------------- |
| 未配置     | `PROVIDER_NOT_CONFIGURED` |
| 密钥无效   | `PROVIDER_AUTH_FAILED`    |
| 网关不可达 | `PROVIDER_UNREACHABLE`    |
| 模型已关闭 | `MODEL_NOT_IN_CATALOG`    |
| 并发保存   | `CONFLICT`                |

## 14. 开工前确认

1. Tellhow 网关是否 OpenAI 兼容、`/v1/models` 是否可用；
2. 是否允许用户继续使用第三方内置厂商；
3. 是否允许用户停用 Tellhow 厂商；
4. 记忆向量等系统能力是否有对应模型。

前 4 项不影响 P1；P2 开工前需要产品方拍板。

## 15. P1 实施记录与偏差（2026-11-23）

### 15.1 交付范围

P1 只交付用户管理：`/admin` 用户列表、搜索、详情、禁用 / 解禁、设 / 撤管理员、撤会话；审计日志未做（无表、无占位接口）。P2 代码未开始。验收口径为 §11 P1 四条 + 工程四项；本轮记录见本节 15.5。

### 15.2 与 §8.2 共享文件预算的偏差

§8.2 的 8 个文件是按 P1+P2 合并列出的，其中 4 个（model-bank 两个 index、`ModelProvider` 枚举、`ModelRuntime`、`globalConfig`）属于 P2，P1 未改。P1 实际还改了下列共享文件，均为**注册 / 接线 / 枚举追加**，没有改既有分支行为：

| 文件                                              | 行数     | 理由                                                                                                        |
| ------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `src/features/NavPanel/routeKey.ts`               | +5       | `NavPanelPortal navKey="admin"` 生效的前置条件；控制台使用自有侧栏，不能继承首页高亮                        |
| `src/app/(backend)/api/auth/[...all]/route.ts`    | +7       | 实现 §12.6 的 `POST /api/auth/admin/* → 404`；拦截规则放在新增 `src/libs/better-auth/adminEndpointGuard.ts` |
| `packages/database/src/index.ts`                  | +1       | 从 `@lobechat/database` 导出新 model，业务层只依赖包入口                                                    |
| `packages/database/src/schemas/index.ts`          | +1       | 导出新 schema（drizzle 聚合入口）                                                                           |
| `packages/types/src/index.ts`                     | +1       | 导出 `adminConsole` 共享类型                                                                                |
| `packages/database/migrations/meta/_journal.json` | +7       | 注册 fork 迁移 9001（迁移文件与 snapshot 为新增文件）                                                       |
| `scripts/fork/reconcileMigrations.ts`             | 1 项     | `FORK_TABLES` 增加 `public.admin_console_settings`；同文件另有 prettier 格式化，未改逻辑                    |
| `packages/locales/src/default/common.ts`          | +2       | 用户菜单入口文案（源文案）                                                                                  |
| `packages/locales/src/default/setting.ts`         | +60      | 控制台全部界面文案（源文案）                                                                                |
| `locales/{en-US,zh-CN}/{common,setting}.json`     | +2 / +58 | 交付英文与中文；其他语言交给自动翻译流程                                                                    |

没有修改上游表结构、`src/features/Settings/**`、`settingsRouter.updateSettings`、`featureFlags`，也没有启用 Better Auth 原生 admin 端点。

### 15.3 实现层面的偏差与取舍

- **`LAST_ADMIN` 不经自助接口触达**：`setUserRole` / `banUser` 对「操作自己」先返回 `SELF_LOCKOUT`（409 `CONFLICT`），因此最后管理员保护只可能在并发或直连数据层时触发。实现仍保留 `pg_advisory_xact_lock(hashtext('admin_console:last_admin'))` 与事务内重算，`packages/database/src/models/adminConsole.test.ts` 覆盖该分支。对外可观察的拒绝语义是 409 + `SELF_LOCKOUT`。
- **禁用返回撤销会话数**：`banUser` 先禁用 API Key、再写账号状态，最后尽力撤 session（失败不回滚禁用），返回 `revokedSessions`。这与 §12.3 的级联顺序一致；解禁不恢复 API Key。
- **`whoami` 是最小暴露面**：普通用户只拿到 `{ isAdmin, role, bootstrapConfigured, canBootstrap }`，不返回他人账号信息；其余接口统一由 `adminProcedure` 抛 `ADMIN_REQUIRED`。
- **前端守卫**：非管理员 `redirect('/')`，未登录跳 `/signin`；菜单入口只对 `isAdmin` 渲染。移动端不注册 `/admin`。
- **原生 admin 端点拦截**：任何 `POST /api/auth/admin/*` 在进入 Better Auth 前返回 404（包含未登录请求），避免绕过控制台的账号状态保护。
- **i18n**：源文案写在 `packages/locales/src/default/`，en-US /zh-CN 同步交付；其他语言等待 `auto-i18n` 工作流。

### 15.4 工程验证

- `npx tsrs --noEmit -p tsconfig.type-check.json --checkers 4`：退出码 0（合并上游 `6d1b24e2de` 后复跑）。
- `npx oxlint` 覆盖 P1 改动文件：0 error / 0 warning。
- P1 新增单测：`packages/database/src/models/adminConsole.test.ts`（5）、`apps/server/src/routers/lambda/adminConsole/permissions.test.ts`（23）、`src/libs/better-auth/adminEndpointGuard.test.ts`（10）、`src/app/(backend)/api/auth/[...all]/adminEndpoint.test.ts`（5）全部通过。
- §11「单测覆盖密钥加解密 / 目录 diff / 运行时凭据优先级」属于 P2，本轮不适用。

### 15.5 产品验收

按 §11 P1 四条在本地真实运行环境验证（独立测试库 + Redis + Next + Vite SPA，`ADMIN_CONSOLE_BOOTSTRAP_EMAILS=agent-testing@lobehub.com`）：

1. 管理员在 `/admin` 搜索 `target` 并能禁用（原因 + 7 天）；禁用后同一 API Key 立即 401，同一密码重新登录返回 403 `BANNED_USER`；`revokedSessions=2`。
2. 设 / 撤管理员在详情抽屉即时生效（`Make admin` ↔ `Revoke admin`）；对自身改角色 / 禁用返回 409 `SELF_LOCKOUT`。
3. 普通用户 `adminConsole.listUsers` 返回 403 `ADMIN_REQUIRED`，未登录返回 401；直达 `/admin` 被重定向到 `/`，页面无管理界面。
4. 配置 `ADMIN_CONSOLE_BOOTSTRAP_EMAILS` 后，首次 `whoami` 把 `role=NULL` 的账号提升为 `admin`，并在 `admin_console_settings.config.bootstrap` 记录时间与用户；再次访问不重复写入。

验收报告：<http://192.168.14.51:3210/acceptance/89de762f-0f6f-4794-8b27-1eefd95cd09a> （8 项检查全部 passed，证据含截图与原始请求输出）。共享文件清单与遗留项见本节与 `CUSTOMIZATIONS.md`。本轮为单人执行，未安排独立 acceptance-checker 复核。
