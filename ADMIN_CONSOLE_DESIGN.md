# 管理员控制台（CUST-008）设计方案

> 状态：P1（用户管理）已实现并通过本地验收（2026-11-23，分支 `feat/admin-console-p1`，实施偏差见 §15）；P2（模型服务）在 `feat/admin-console-p2` 上分步落地，P2-1 / P2-2 已完成，其余见 §15.6。审计日志不做。原型见 `prototypes/admin-console/`。

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
    └─ 默认值：全站默认模型与后台任务兜底（CUST-011，见 §7.1）
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
- 新用户的厂商开关默认只有 Tellhow 打开，其它内置厂商默认关闭；用户在设置里打开即照常可用（**默认关闭 ≠ 禁止**，见 §7.2）；
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

### 5.5 默认值（CUST-011：管理员默认值 = 全站默认值）

产品语义：管理员在「默认值」里设定的四项（chat /title/verify/embedding）是**全站默认模型**，不是「只给新用户用一次的初始值」。用户没自选就跟随它，用户自选过则保留自选；存量用户、新注册、SSO 首次登录一视同仁，后台任务（标题生成、记忆向量、任务验收）也以它为兜底。

P2 原文「只影响新用户创建时的初始值，不写存量用户」是当时的旧口径，已被 CUST-011 取代（2026-11-26）：那条口径下管理员改默认值，存量用户与后台任务都不会变，正是本次反馈的现象。

- 新用户默认对话模型（chat）：主档全部槽位 + 新会话默认模型（`defaultAgent.config`）；
- 记忆 / 知识库向量模型（embedding）：只到 `userMemoryEmbedding`；`fileEmbedding` 仍由 `DEFAULT_FILES_CONFIG` 管（换模型会让已嵌入文件失效，不跟随默认值）；
- 标题生成 / 历史压缩等轻量后台任务（title）：flash 档全部槽位；
- 任务校验（verify）：`verify` 槽位，必须是多模态（视觉）模型。

确定性映射、自选判定、逐槽位兜底顺序与不可用模型回退见 **§7.1**；本轮只落文档，实现与验收见 T-90 \~ T-94。

**界面口径（T-93，2026-11-26）**：管理端四项与个人页四档**同名同序**—— 主模型 / Flash 模型 / 验收模型 / 记忆向量化模型；卡片说明不再写「只影响新用户」，改为「对未自选模型的全部用户与后台任务生效，用户自选后以自己的为准」；只列对用户开放的模型。验收模型下拉按 `capabilities.includes('vision')` 过滤。

**选择器只列能生效的模型（T-102，2026-11-27）**：四项默认值统一按 `resolveCompanyServiceDefaults` 的可见集过滤 —— `open === true` 且无 `removedAt`；验收模型再加视觉能力。已存但当前不可用的值仍留在下拉里并标注原因（未对用户开放 / 上游已移除 / 不可用），字段下给出对应提示（`modelService.defaults.closed` / `removed` / `invalid` / `verifyInvalid`），不再出现「保存成功、用户侧毫无变化、界面也没有提示」。原因判定在 `src/features/AdminConsole/ModelService/utils.ts` 的 `defaultModelIssue`，与解析器共用同一套可见性规则。个人页只在管理员真的设过的档位显示「管理员默认」（来源标记 `serverConfig.companyDefaultTiers`），其余仍是「系统推荐」；部署里存在任意管理员默认档时，四档标题下补一句「未自选时用管理员默认（该档没设时沿用系统推荐），自选后以自己的为准」。

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
- **模型服务**：服务连接、模型目录（拉取 + 手工添加 + 编辑弹窗）、默认值（全站默认模型，CUST-011）。

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

### 7.1 默认值解析（CUST-011）

`updateModelServiceConfig` 的 `defaults` 只写 `admin_console_settings.config.ai.defaults`，**接口层不做传播**：不新增 procedure、不写任何用户行、不新增迁移；保存后由用户侧下一次读取（下一次页面请求 / 下一次后台任务）按本节规则解析。

P2 交付时它是「只存不用」：`getCompanyProviderRuntime()` 把 `defaults` 放进 `CompanyProviderRuntime.defaults`（`packages/business-server/src/companyProvider.ts`），全仓库没有消费者。所以管理员改默认值，存量用户、新用户与后台任务都不会变。CUST-011 补的就是这段消费。

**映射**（唯一事实源：`packages/const/src/settings/systemAgent.ts` 的 `SERVICE_MODEL_TIER_SLOTS`）

| 管理员默认值 | 解析到的槽位                                                                                                                                                                                                | 说明                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `chat`       | `SERVICE_MODEL_TIER_SLOTS.main`：`agentMeta` / `expertise` / `goal` / `topicAutoSummary`；外加 `defaultAgent.config`                                                                                        | 主档全部槽位 + 新会话默认模型                  |
| `title`      | `SERVICE_MODEL_TIER_SLOTS.flash`：`topic` / `thread` / `generationTopic` / `translation` / `promptRewrite` / `memoryAnalysisAgentConfig` / `userMemoryPersonaWriter` / `inputCompletion` / `followUpAction` | 标题、历史压缩、翻译、提示词改写等轻量后台任务 |
| `verify`     | `SERVICE_MODEL_TIER_SLOTS.verify`：`verify`                                                                                                                                                                 | 必须视觉模型；pinned verifier agent 优先于本节 |
| `embedding`  | `SERVICE_MODEL_TIER_SLOTS.embedding`：`userMemoryEmbedding`                                                                                                                                                 | 记忆向量；换模型需重新索引                     |
| —            | `fileEmbedding` 仍由 `DEFAULT_FILES_CONFIG` 管；`asr` / `channelRouting` /onboarding 槽位不归管理员默认值                                                                                                   | `fileEmbedding` 跟随档位会让已嵌入向量失效     |

槽位清单不在本节硬编码：上游增删槽位只改 `SERVICE_MODEL_TIER_SLOTS`，映射自动跟随（与 §16 的 lab 闸门同一思路）。

**provider**：默认值的模型 id 属于 Tellhow 目录，解析出的 provider 固定为 `tellhow`。不提供「默认值指向其他 provider」的能力 —— 其他厂商属于用户个人自选。

**生效规则**

1. 用户自选优先，不被管理员默认值覆盖：
   - 槽位 pin：`user_settings.systemAgent[slot]` 带 `model` + `provider`，且不等于该槽位所属档位的 pin（`systemAgent.tiers[tier]`）→ 保留用户选择；
   - 档位选择：`systemAgent.tiers.{main,flash,verify,embedding}` 有值时，个人页的 `syncTierPins` 已把该档模型写进它管辖的槽位（`src/features/ServiceModel/serviceModelState.ts`），所以「用户选了档」= 已自选，槽位跟用户选的档，不跟管理员默认值；
   - 新会话模型：`user_settings.defaultAgent.config` 带 `model` + `provider` → 保留用户选择；
   - **自选判定必须读存储行**（`user_settings`）。不能读客户端合并后的 `currentSettings`：后者已混入默认值，会把「跟随」误判成「自选」。
2. 未自选 → 管理员默认值：存量用户、新注册、SSO 首次登录同一套规则；某个槽位没有管理员默认值时，继续走第 4 条的下一级。
3. **不写入用户行**：管理员默认值只在解析时兜底。写进 `user_settings` 等于固化，管理员之后再改默认值这些用户就不再跟随；`initNewUserForBusiness` 在本仓库是空实现（`packages/business-server/src/user.ts`），新用户本来没有设置行。
4. 逐槽位优先级：

```text
用户自选 > 管理员默认值 > SYSTEM_AGENT / DEFAULT_AGENT_CONFIG 环境变量 > 代码默认
```

- 客户端：管理员默认值经 `serverConfig.systemAgent` / `serverConfig.defaultAgent` 注入，仍走 `src/store/user/slices/common/action.ts` 的 `#project` → `defaultSettings`，再由 `currentSettings = merge(defaultSettings, settings)` 合并；既有 selector 不改。
- 环境变量继续生效，只是排在管理员默认值之后；管理员留空（`inherit`）即回到环境变量。
- 写盘侧的 diff 基准仍是 `defaultSettings`：用户显式选回「跟随」时 `replaceServiceModelSettings` 删除槽位键，槽位重新跟随默认值；不要改成合并写。

**后台任务兜底**（无当前标签页的调用，顺序同上）

| 读取点                                                                | 现状                                                                         | 目标                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 标题 / 翻译 / 技能元数据 / 任务复盘等 `resolveSystemAgentModelConfig` | 用户槽位 → 代码默认（`apps/server/src/services/systemAgent/modelConfig.ts`） | 用户槽位 → 管理员默认值 → `SYSTEM_AGENT` → 代码默认                   |
| 验证 `resolveVerifyServiceModel`                                      | 用户槽位 → `SYSTEM_AGENT` → `VERIFY_FALLBACK_MODEL_CONFIG`                   | 用户槽位 → 管理员默认值 → `SYSTEM_AGENT` → 代码默认                   |
| 记忆向量 `userMemoryEmbedding`（记忆抽取 runtime）                    | 用户槽位 → `MEMORY_USER_MEMORY_EMBEDDING_*` / 内置默认                       | 用户槽位 → 管理员默认值 → `MEMORY_USER_MEMORY_EMBEDDING_*` / 内置默认 |
| 文件向量 `fileEmbedding`                                              | `DEFAULT_FILES_CONFIG`                                                       | 不变                                                                  |

约束：前台与后台必须共用**一个**解析函数（放在 `packages/business-server`），不允许每条链路各写一份「管理员默认值优先」，否则回退顺序会漂移。顺带修正一处现存偏差：`resolveSystemAgentModelConfig` 今天连 `SYSTEM_AGENT` 都不读，后台任务连环境变量默认值都不生效。

**已落地（T-91）**：管理员层只有 `packages/business-server/src/adminConsole/serviceDefaults.ts` 一个出口（`resolveCompanyServiceDefaults` 给整块、`getCompanyServiceDefaultModel` 给单槽位），都走 `getCompanyProviderRuntime` 的 5 s 缓存。`resolveSystemAgentModelConfig` 按 `override > 用户自选 > 管理员默认 > SYSTEM_AGENT > 代码默认` 解析，且只在用户没选全时才读管理员层；`resolveVerifyServiceModel` 在用户与 `SYSTEM_AGENT` 之间插入管理员 `verify`；记忆抽取把 `serverConfig.systemAgent`（管理员已压在 env 之上）合并到用户设置之下再走原有 `MEMORY_*` / 内置默认。记忆抽取跟随管理员默认时 provider 是 `tellhow`，`resolveRuntimeAgentConfig` 用 `resolveCompanyProviderParams` 取服务端密钥，不能用用户 keyVaults。

**已落地（T-104，后台运行时取凭据）**：后台任务不能依赖「5 s 进程快照」，理由有两条：新起的进程里可能没有任何一次聊天请求预热过它；Next 的服务端 chunk 各带一份 `companyProvider` 模块副本，各自持有自己的缓存。因此：

1. `resolveRuntimeAgentConfig` 新增 `companyCredential` 入参，优先级为「调用方异步读到的控制台凭据 → 进程快照 → `TELLHOW_*` 环境变量」；取不到时不再回落用户 keyVaults，而是抛可读的「服务不可用」，并在日志里点名槽位（`embedding` / `gatekeeper` / `layer extractor`）。
2. 记忆抽取（`getRuntime`）、个人化写入（persona writer）、记忆归并（consolidation）在解析运行时之前用**自己的 db 句柄**调 `resolveCompanyProviderCredential()`（即 `getCompanyProviderRuntime`，顺带刷新共享缓存）。
3. 向量槽位（`userMemoryEmbedding`）取不到可用 provider 时降级而不是中断整轮：`RuntimeBundle.embeddingsAvailable = false`，本轮记忆照常抽取并落库，只是不写向量、检索阶段直接跳过（不把「部署没有向量模型」记成 retrieval error）；写库时的向量化本来就容忍空向量。
4. 验收计划拆分（`verify-plan-generator`）改走 `resolveVerifyServiceModel`：用户 `verify` 自选 → 管理员 `verify` 默认 → `SYSTEM_AGENT`，兜底仍是 `VERIFY_PLAN_MODEL_CONFIG`。只有 Tellhow 目录的部署因此不会因为 pinned 的 DeepSeek 无密钥而把每份清单静默塌成单行 holistic。

**不可用模型回退**（不产生指向不可用模型的默认值）

`validateDefaults` 只校验「id 在目录里」，不校验 `open`；目录同步又只写 `removedAt` 不删行。因此解析时逐项判定：

| 条件                                               | 结果                                 |
| -------------------------------------------------- | ------------------------------------ |
| `config.ai.enabled !== true`、缺 `baseURL`、缺密钥 | 整块默认值视为未配置，全部回退下一级 |
| 该项模型 `open === false`                          | 该项视为未配置（用户侧看不到它）     |
| 该项模型带 `removedAt`                             | 同上（上游已移除）                   |
| 槽位被用户 pin                                     | 不受影响，保留用户选择               |

保存时仍允许「先选默认值、后开放模型」的顺序（校验不变）；管理端 UI 需标注「该模型当前未对全员开放，默认值暂不生效」（T-93）。

**备选口径（本次不实施，待用户确认可切换）**

强制覆盖所有用户自选（含槽位 pin、档位 pin、`defaultAgent.config`）。只在产品方明确要求「管理员改默认值，所有人立刻跟着变」时启用；届时建议做成 `config.ai.defaults.mode: 'follow' | 'force'`（默认 `follow` = 本节口径），个人页显示「由管理员统一指定」。`force` 也只做解析覆盖、不改用户行 —— 否则切回 `follow` 时用户原选择已丢失。风险：用户改了又被改回去，「用户显式选择」也会失去意义。

**实现与验收分工**：T-90 注入 `serverConfig` + 统一解析函数；T-91 后台任务读取点改走同一函数；T-92 新用户默认只开 TellhowAI（默认模型之外的另一件事）；T-93 个人服务模型页与管理端默认值文案；T-94 存量 / 新注册 / SSO 三条真实链路验收。

### 7.2 厂商默认开关（CUST-011-C）

产品口径：新用户（注册、SSO 首次登录）打开「AI 服务商」时，只有 TellhowAI 的开关是开的，其它内置厂商默认关闭。用户自己打开某个厂商后照常可用；自定义厂商不受影响。

**「默认关闭」不是「禁止」**。厂商是否可用由两处值「或」出来（`packages/database/src/repositories/aiInfra/index.ts:105-107`）：

```text
最终 enabled = 用户 ai_provider.enabled  或  服务端 serverConfig.aiProvider[id].enabled
```

CUST-011-C 只改后半段（默认值），前半段仍是用户自己的选择：用户点开开关就写用户行 `enabled: true`，列表、模型选择器与后续请求都恢复正常。自定义厂商（`source: 'custom'`）只存在于用户行，这份默认值根本不参与。

**开关**：`packages/business/const/src/index.ts` 的 `DEFAULT_ONLY_COMPANY_PROVIDER_ENABLED`（本 Fork 为 `true`）。生效点在 `apps/server/src/globalConfig/index.ts` 的 `getAiProviderSpecificConfig()`：

```ts
for (const provider of Object.values(ModelProvider)) {
  aiProviderSpecificConfig[provider] = {
    ...aiProviderSpecificConfig[provider],
    enabled: provider === COMPANY_PROVIDER_ID, // tellhow
  };
}
```

合并写法是硬要求：上方那些 `fetchOnClient` / `modelListKey` / `withDeploymentName` 是厂商元数据，不能被默认开关冲掉。

**与 `withCompanyProviderCatalog()` 的分工**：控制台仍然决定 Tellhow 的生死 ——`getServerGlobalConfig()` 在 `genServerAiProvidersConfig()` 之后调用 `withCompanyProviderCatalog()`，未配置或管理员关闭时把 `tellhow.enabled` 覆盖为 `false`，用户侧立即不可见（§5.6 不变）。默认开关只负责「Tellhow 之外的厂商默认关」。

**为什么不复用 `ENABLE_BUSINESS_FEATURES`**：`getAiProviderSpecificConfig()` 里已有一条现成的「只开内置厂商」分支（`enabled: provider === ModelProvider.LobeHub`），但它与业务特性总开关绑定 —— 后者还决定 `agentGatewayProtocol`、页面协作与 `isOfficialProvider`，且默认厂商是 `lobehub` 不是 `tellhow`。本 Fork 必须保持 `ENABLE_BUSINESS_FEATURES = false`，所以复制写法、另立只表达「默认厂商集合」的常量。

**对服务端解析零影响（T-92 已用测试证明）**：`initModelRuntimeFromDB()` 只读用户 / 厂商行与控制台凭据，从不读 `aiProvider[id].enabled`：

| 链路                                                                                           | 是否读厂商级默认 | 说明                                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 标题 / 翻译 / 技能元数据（`resolveSystemAgentModelConfig → initModelRuntimeFromDB`）           | 否               | 只解析 model + provider，随后按凭据初始化                                                                                                       |
| 记忆抽取 / 向量（`getAiProviderRuntimeState` → `enabledAiModels` / `tryMatchingProviderFrom`） | 否               | 用**模型级** `enabled`，不是厂商级                                                                                                              |
| 任务验收（`resolveGoalReviewModelConfig` 的 `initModelRuntimeFromDB` 探针）                    | 否               | 凭据初始化失败才算不可用                                                                                                                        |
| 异构 Agent 部署目录（`getEnabledServerChatModels` / `resolveServerModel`）                     | 是               | 前者只查 `lobehub` relay 目录（本 Fork 不用）；后者只用于压缩模型的 `deploymentName` 兜底查找，查不到就退回裸模型 id（best-effort，不影响请求） |
| 用户侧厂商列表 / 模型选择器（`getAiProviderList`）                                             | 是               | 这就是本开关要影响的那一处                                                                                                                      |

`apps/server/src/modules/ModelRuntime/providerDefaults.test.ts` 用真实初始化路径锁住：无用户行的新用户调用 Tellhow 成功；默认关闭的 openai /deepseek 在用户打开后仍能初始化；自定义厂商不受影响。

**已知取舍**：开启后内置厂商的 `ENABLED_*` 环境变量不再把该厂商在用户侧默认打开（凭据仍生效，用户打开开关即可用）；桌面端 `ollama` 也一并默认关闭（本 Fork 为 Web 部署）。需要另一个默认开启的厂商时，改 `getAiProviderSpecificConfig()` 的放行表达式，不要改 `ENABLE_BUSINESS_FEATURES`。

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
8. `ssrfSafeFetch` 的选项与默认策略是否变化（企业内网网关的白名单方式）；
9. `SERVICE_MODEL_TIER_SLOTS` 是否仍覆盖 main /flash/verify/embedding 四档且 `fileEmbedding` 不在其中；上游增删槽位时管理员默认值映射要自动跟随（§7.1）；
10. `getServerGlobalConfig` 仍组装 `systemAgent` / `defaultAgent`，且客户端 `#project` 仍把它们合并进 `defaultSettings`；这两处任一被上游重构，「未自选 = 跟随默认」就会失效；
11. 后台任务读取点（`resolveSystemAgentModelConfig`、`resolveVerifyServiceModel`、记忆抽取 runtime）仍经过统一解析函数，不能被上游改成各写一份默认值；
12. `companyProvider` 的 `defaults` 仍随 5 s 进程内缓存返回，并由 `invalidateCompanyProviderCache()` 在保存后失效。
13. 厂商默认开关（CUST-011-C）依赖三处，任一处被上游重构都要重跑 `getServerGlobalConfig` / `getAiProviderList` / `providerDefaults`：`getAiProviderSpecificConfig()` 的显式 `enabled` 覆盖、`AiInfraRepos.getAiProviderList()` 的「用户行 OR 服务端配置」合并、`withCompanyProviderCatalog()` 在 `genServerAiProvidersConfig()` 之后对 `tellhow.enabled` 的最终覆盖。
14. `ENABLE_BUSINESS_FEATURES` 语义不得被改成「只开 tellhow」（它还控制网关协议、页面协作与 `isOfficialProvider`）；上游若把「只开内置厂商」抽成独立参数，可改为复用，但默认厂商必须仍是 `COMPANY_PROVIDER_ID`。
15. `ProviderSpecificConfig` 新增字段时，默认开关的覆盖循环必须保持 `{ ...existing, enabled }` 的合并写法，否则 `fetchOnClient` / `modelListKey` / `withDeploymentName` 会丢。

## 11. 验收清单

**P1**

- [ ] 管理员能搜索、禁用用户；禁用后 API Key 立即 401，重新登录被拒；已在线会话尽力撤销；
- [ ] 设 / 撤管理员立即生效；撤销最后一个 admin / 禁用自己 → `CONFLICT`；
- [ ] 非管理员访问 `/admin/*` 返回 `ADMIN_REQUIRED`，直达 URL 重定向首页；
- [ ] 配置 `ADMIN_CONSOLE_BOOTSTRAP_EMAILS` 后，首次访问 `/admin` 成为管理员。

**P2**

- [ ] 用户首次登录，设置 → AI 服务商里看到「泰豪 AI」已启用，无需填 Key；
- [ ] 新用户只有 TellhowAI 默认开启，其它内置厂商默认关闭；用户自己打开某个厂商后可用；管理员关闭 Tellhow 后该厂商不可见（CUST-011-C，§7.2）；
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

## 14. 开工前确认（P2 结论，2026-11-24 回写）

P2 开工时有 4 项产品假设。P2 交付时在本地真实运行环境（真实 Next + Vite SPA + Postgres/Redis + 本地 OpenAI 兼容网关）逐项验证，结论如下。

| #   | 假设                                                             | 结论                     | 依据（详见 §15.7 与验收报告）                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tellhow 是 OpenAI 兼容接口，`GET {baseURL}/v1/models` 可用       | **成立**                 | 管理端「Test connection」返回 `Connected · 148ms · 4 models`；目录同步一次返回 4 个上游模型并全部以 `pending`（Needs review）/`open: false` 落库。                                                                                                                                                |
| 2   | 允许用户自建第三方厂商，与 Tellhow 并存、互不影响                | **成立**                 | 新注册用户同时拥有「Tellhow AI」与自建 OpenAI 兼容服务商；两个服务商各自出现在模型列表，切换后对话互不影响；管理员侧配置变更只影响 Tellhow。                                                                                                                                                      |
| 3   | 用户可在设置里「停用泰豪 AI」（只是不展示，不删除管理员配置）    | **成立（部分 UI 限制）** | 服务商列表提供 Enable/Disable 开关，停用后 Tellhow 从用户「Enabled」分组移到「Disabled」，`admin_console_settings` 行与管理员目录不变；重新启用即恢复。用户侧只能整体停用，不能改地址 / 密钥 / 目录（`showConfig: false`），也不能删除管理员配置。                                                |
| 4   | 记忆向量 / 标题生成 / 校验等系统能力由 `config.ai.defaults` 指定 | **成立（实现层）**       | 管理端 Defaults 卡片把 `defaults.{embeddingModel,titleModel,verifyModel}` 写入 `config.ai`，`getCompanyProviderRuntime()` 原样读出；系统能力仍按 `user_settings.system_agent` / 环境变量解析，未做覆盖写入，默认值只影响未单独配置的用户。P2 未对「已有用户显式覆盖」做产品级验证，留待需要时补。 |

原始 4 条假设保留如下，便于对照：

1. Tellhow 网关是否 OpenAI 兼容、`/v1/models` 是否可用；
2. 是否允许用户继续使用第三方内置厂商；
3. 是否允许用户停用 Tellhow 厂商；
4. 记忆向量等系统能力是否有对应模型。

假设 4 的结论已由 CUST-011 修订（2026-11-26，见 §7.1）：`defaults` 的真实字段是 `{ chat, embedding, title, verify }`（不是 `embeddingModel` / `titleModel` / `verifyModel`），且 P2 交付时只存不用；「只影响未单独配置的用户」这半句保留，但解析链要补管理员默认值这一级。

前 4 项不影响 P1；P2 开工前需要产品方拍板。P2 已按上述结论交付；若产品方改变结论，改动点集中在 `packages/business-server/src/companyProvider.ts`（默认关闭 / 读取）、`src/features/AdminConsole/ModelService/*`（管理端）与 provider 卡片开关，不需要数据库迁移。

## 15. P1 实施记录与偏差（2026-11-23）

### 15.1 交付范围

P1 只交付用户管理：`/admin` 用户列表、搜索、详情、禁用 / 解禁、设 / 撤管理员、撤会话；审计日志未做（无表、无占位接口）。P2 在后续分支分步实现，已完成部分见 §15.6。验收口径为 §11 P1 四条 + 工程四项；本轮记录见本节 15.5。

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

### 15.6 P2 实施记录

#### P2-1 Tellhow provider（2026-11-24）

- `packages/model-bank/src/modelProviders/tellhow.ts`、`packages/model-bank/src/aiModels/tellhow.ts`、`ModelProvider` 枚举与两个 index 导出；provider 走 i18n 文案。
- 未改 `aiProvider` / `aiModel` mutation、`settingsRouter.updateSettings`、`featureFlags`。

#### P2-2 `config.ai`（2026-11-24）

- **类型**：`packages/types/src/adminConsole.ts` 增加 `AdminConsoleAiConfig` / `AdminConsoleAiConfigView` / `AdminConsoleAiKey` / `AdminConsoleAiKeySummary` / `AdminConsoleAiDefaults` / `AdminConsoleAiLastTest` / `CompanyModel`（`type: AiModelType`）/ `CompanyModelCapability`；`AdminConsoleSettingsConfig.ai?` 可选。时间全部为 ISO 字符串。
- **数据访问**：`AdminConsoleSettingsModel` 承担 `admin_console_settings` 单例读写（P1 的 `AdminConsoleModel` 继承它）；`updateSettingsConfig` 在事务内用 `pg_advisory_xact_lock(hashtext('admin_console:settings'))` 串行化，并按 `updatedAt` 做乐观锁，过期返回 `CONFLICT` / `CONFIG_CONFLICT`。
- **业务**：`packages/business-server/src/adminConsole/modelService.ts` 校验 http (s) baseURL、`AiModelType`、模型 id 唯一、默认模型必须在目录中；API Key 复用 `KeyVaultsGateKeeper` 加密，持久化只存 ciphertext + last4 + updatedAt + updatedBy；读取经 `toConfigView` 显式挑字段，任何响应不含明文或密文。
- **接口**：`getModelServiceConfig` / `updateModelServiceConfig` 挂在 `adminConsole` router 的 `adminProcedure` 下；`updateModelServiceConfig` 接受 `expectedUpdatedAt`。
- **约束**：不新增迁移，不写 `user_settings`；`AdminConsoleModel` 的 P1 行为通过继承保持。
- **测试**：`apps/server/src/routers/lambda/adminConsole/modelService.test.ts` 15 项（加密脱敏、非法 type /baseURL/ 重复 id / 默认模型、乐观锁、权限、`user_settings` 不变）；P1 的 permissions 23 项与 database `adminConsole.test.ts` 5 项同时通过。
- **遗留**：`companyProvider`、运行时注入、测试连接 / 目录同步、`/admin` 模型服务页由 P2-3 \~ P2-6 完成。

#### P2-3 `companyProvider` 与运行时注入（2026-11-24）

- **读取层**：`packages/business-server/src/companyProvider.ts` 是 `config.ai` 的唯一读取入口。`getCompanyProviderRuntime()` 读单例行、用 `KeyVaultsGateKeeper` 解密、只保留 `open && !removedAt` 的模型，5 s 进程内缓存且并发仅一次读；读失败保留上一次成功配置（§5.6）。`getCompanyProviderRuntimeSnapshot()` 是给同步调用方用的快照视图。
- **关闭态**：无行、`enabled: false`、缺 baseURL、缺密钥一律解析为 `null`，用户侧不出现 Tellhow。默认关闭，回滚只需回代码。
- **凭据优先级**：payload 自带值 > 控制台配置 > `TELLHOW_API_KEY` / `TELLHOW_PROXY_URL` > 可读错误。用户自带 `baseURL` 时绝不附带公司 Key，避免把管理员凭据发送到用户端点。
- **运行时**：`initModelRuntimeFromDB` 先调 `ensureCompanyProviderReady(provider, db)`（仅 tellhow 触发读库），随后 `getParamsFromPayload`（保持同步、签名不变）的 tellhow 分支经 `resolveCompanyProviderParamsOrThrow()` 注入 baseURL 与解密后的 Key；`canUseServerProviderConfig` 显式允许 tellhow 使用部署凭据，并保留「payload 不带 baseURL」等既有判定。关闭态抛 `NoAvailableProvider` + 固定文案（`createErrorResponse` → 400），`normalizeChatMessageError` 后前端显示同一句话，提示切换模型，不是 500。
- **目录合并**：`withCompanyProviderCatalog()` 把控制台目录写入 `aiProvider.tellhow` 的 `enabled` / `enabledModels` / `serverModelLists`（每项 `enabled: true`、`fetchOnClient: false`），`globalConfig` 只加一处调用。关闭时清空 `serverModelLists`，用户侧列表立即隐藏。
- **缓存失效**：`updateModelServiceConfig` 保存成功后调用 `invalidateCompanyProviderCache()`，保存即生效；多副本一致性仍按 §5.3 留到需要时再做。
- **出站**：新增 `companyProviderFetch()` / `companyProviderSsrfOptions()`，统一走 `ssrfSafeFetch`，并按「本条地址」显式放行 ——IP 字面量进 `allowIPAddressList`，域名给该次调用 `allowPrivateIPAddress`，不使用 `SSRF_ALLOW_PRIVATE_IP_ADDRESS=1`。运行时模型请求仍由 provider SDK 直连（管理员配置的端点等同 `*_PROXY_URL` 的操作方信任端点），控制台侧的测试连接 / 目录同步由 P2-4 复用该函数。
- **测试**：`companyProvider.test.ts` 15 项（关闭态、解密与目录过滤、TTL / 失效、读失败保底、凭据优先级、无密钥泄漏、目录合并、SSRF 放行），`tellhow.test.ts` 4 项（注入、关闭态可读错误、payload 优先、不混用凭据），`companyProvider.integration.test.ts` 3 项基于 PGlite + 真实 `AiInfraRepos`（启用即列出 Tellhow 与开放模型、关闭即消失、用户视图不含明文 / 密文）。
- **共享文件**：`apps/server/src/globalConfig/index.ts` +4/−1（import + 一处调用），`apps/server/src/modules/ModelRuntime/index.ts` +10/−1，分四处：import +1、`canUseServerProviderConfig` +2/−1、tellhow 分支 +4、预热 +2，均在 §8.2 的每处 10 行以内（整文件亦为 10 行）。

#### P2-4 测试连接与目录同步（2026-11-24）

- **新增文件**：`packages/business-server/src/adminConsole/modelCatalog.ts` 承担两个管理端操作；接口 `testModelServiceConnection` / `refreshModelCatalog` 追加在既有的 fork 自有 router `apps/server/src/routers/lambda/adminConsole/modelService.ts`（两个接口均走 `adminProcedure`）。未改任何 §8.2 共享文件。
- **测试连接**：`testConnection()` 用已保存的地址 + 解密后的 Key 请求 `GET {baseURL}/models`（`buildModelsUrl` 容忍末尾斜杠与已带 `/models`），返回 `{ ok, latencyMs, modelCount, errorCode? }` 并把结果写入 `config.ai.lastTest`；服务处于 `enabled: false` 时也可测试（启用前先验证）。`latencyMs` 量到响应头。
- **错误码**：`PROVIDER_NOT_CONFIGURED`（未保存地址 / 密钥）、`PROVIDER_AUTH_FAILED`（401 / 403）、`PROVIDER_HTTP_ERROR`（其他非 2xx）、`PROVIDER_INVALID_RESPONSE`（非 JSON 或无模型数组）、`PROVIDER_UNREACHABLE`（DNS / 连接 / TLS / SSRF 拦截）、`PROVIDER_TIMEOUT`（`timeoutMs` 默认 10 s，可按调用覆盖）。错误码是 `ADMIN_CONSOLE_ERROR` 的稳定值，响应不含上游 body。
- **目录同步**：`refreshCatalog({ apply, expectedUpdatedAt? })` 拉取上游后与 `config.ai.models` 做 diff：
  - 新增：`source: 'sync'`、`pending: true`、`open: false`；`name` / 上下文 / 能力从仓库已有目录带出，未命中时 `name = id`；
  - 上游消失：仅对 `source: 'sync'` 行写 `removedAt`，**不删除**；手工行（可能是别名）不动；上游重新出现则清除 `removedAt`；
  - 已存在行：`name` / `open` / `type` 一律不改（管理员决定），只补缺失的 `contextWindowTokens` / `capabilities`；
  - 类型：§5.4 命名规则优先，规则不中时用仓库目录里的 `type`，仍未定则回落 `chat` 并在 `diff.needsReview` 列出，写库前仍经 `AiModelType` 校验；
  - `apply: false` 只返回 diff；`apply: true` 仅在确有变化时写入，写入复用 `updateConfig`（同一套校验 + `updatedAt` 乐观锁），因此重复 apply 幂等且不推进 `updatedAt`。
- **出站**：两个操作统一走 `companyProviderFetch()`（即 `ssrfSafeFetch` + 本条地址放行），并为 `/models` 响应体加 1 MiB 上限（`MODEL_CATALOG_MAX_BODY_BYTES`）。
- **测试**：`modelCatalog.test.ts` 51 项（URL / 响应解析、9 类类型推断、新增・消失・未变化・恢复・幂等 diff、管理员编辑不被覆盖、错误码映射、超时、apply 幂等 / 版本透传），`modelCatalog.router.test.ts` 9 项（PGlite + tRPC：两个接口 admin 可用、非管理员 `ADMIN_REQUIRED`、`lastTest` 落库、dry-run 不写、apply 后新增关闭待确认、二次 apply 不写、非法存量类型拒绝、网关不可达错误码）。

#### P2-5 `/admin` 模型服务页（2026-11-24）

- **页面**：`src/features/AdminConsole/ModelService/index.tsx` 组合 Connection / Catalog / Defaults 三张卡片；路由 `src/routes/(main)/admin/model-service` 挂在既有 `adminConsoleRoute` 下，未改共享路由文件。保存、测试连接、目录搜索 / 类型筛选 / 开放开关、手工增删改、同步 diff 预览与应用都在同一页完成；乐观锁冲突弹「刷新」确认框。
- **共享文件**：0 个。文案追加在 `packages/locales/src/default/setting.ts` 与 `locales/{en-US,zh-CN}/setting.json`。

#### P2-6 用户侧联调与真实验收（2026-11-24）

环境：本地真实运行分支 `feat/admin-console-p2`（Next 16 + Vite SPA + Postgres/Redis + 本地 QStash），测试用户为新注册普通账号，Tellhow 上游是本地 OpenAI 兼容网关（`/v1/models` + `/v1/chat/completions`）。

逐条结果（证据见验收报告）：

1. **通过**：用户「设置 → 服务商」的 Enabled 分组第一项即 **Tellhow AI**，页面无任何密码输入框；服务商详情页也没有地址 / 密钥 / 目录编辑入口（`showConfig: false`）。
2. **通过**：聊天模型列表按 `tellhow` 过滤只剩 `tellhow-chat-pro` / `tellhow-chat-lite`（管理员开放的两项）；关闭 `tellhow-chat-lite` 后用户侧列表立即只剩 `tellhow-chat-pro`，重新开放后恢复。
3. **部分通过**：用户可同时保留自建服务商与 Tellhow，模型列表互不覆盖；本轮用 Tellhow 完成了真实对话（见第 5 条），但没有在同一轮里跑通「自建服务商对话」的完整 UI 流程，留待产品方按需补测。
4. **通过**：`adminConsole.getModelServiceConfig` 只返回 `last4` / `updatedAt` / `updatedBy`；`config.ai.apiKey.ciphertext` 只存在于数据库；设置页、对话与测试连接的请求 / 响应中均未出现明文或密文密钥。
5. **通过**：管理端 Test connection → `Connected · 148ms · 4 models`；改成错误密钥 → `ok:false / PROVIDER_AUTH_FAILED`；改回 → `ok:true / 570ms / 3 models`。用户用 `tellhow-chat-pro` 发起对话，上游收到带 `Authorization: Bearer` 的 `/v1/chat/completions`，界面渲染回复。
6. **通过**：目录同步新增 4 项全部 `pending`（Needs review）且 `open:false`；把 `tellhow-vision` 从上游移除后 dry-run 报 `removed: 1`，apply 后该行仍在目录中并带 `removedAt`；上游重新出现后 `removedAt` 被清除。
7. **修复后通过**：`enabled:false` 后 Tellhow 从用户服务商列表与模型列表消失；已有会话的下一次请求原本返回 `InvalidProviderAPIKey` 并在界面显示通用错误 —— 根因是 `getParamsFromPayload` 按 `runtimeProvider`（provider 卡声明的 `sdkType: 'openai'`）分支，关闭态没有走到 tellhow 分支。已在 `getParamsFromPayload` 增加 provider 级前置判断，`tellhow.test.ts` 补回归用例；修复后同一操作返回 `NoAvailableProvider` + 固定文案。
8. **通过**：保存配置前后对 `user_settings` 的 `key_vaults` / `general` / `language_model` 三列做 md5 对比，所有行完全一致。

联调同时修复：`/admin` 深链在 Web 根路径 307 回首页（`src/proxy.ts` 的 matcher 缺 `/admin`），已补 `/admin`、`/admin/(.*)` 并给 `src/proxy.test.ts` 加回归用例。

工程门禁：改动文件 oxlint 0 error；`tsrs --noEmit -p tsconfig.type-check.json` 退出码 0；`tellhow.test.ts` 6/6 通过。共享文件最终清单见验收报告与 PR 描述。

验收报告：<http://192.168.14.51:3210/acceptance/98d0b60e-0026-4e7f-ab48-23d4091cd271>（3 项检查；八条证据见报告）。合入：PR #8 已 merged 到 canary；P2-6 修复另以 `6dfaa3ec85` 直接推送到 canary（本机无 `gh` / GitHub token，无法新开 PR 或编辑 PR #8 描述）。

## 16. CUST-009：管理员统一 Labs 开关

方案与取舍见本节；实现分布在 `packages/business-server/src/labs/`（解析）、`packages/business-server/src/adminConsole/labs.ts`（存储与写校验）、`src/features/AdminConsole/Labs/`（矩阵页）。设计目标是**上游新增一个 lab 时，本 fork 零改动即可跟随**；三道闸门把这个承诺变成可执行的检查。

### 16.1 三道闸门

| 闸门       | 落点                                                                                                                      | 断言                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 一、编译期 | `src/features/Settings/labs/features.ts` 的 `LabFeatureItem.flag: keyof typeof labPreferSelectors`                        | catalog 里的 flag 必须是真实 selector，写错编译不过。无需额外代码，本阶段仅确认。                                                      |
| 二、测试期 | `src/features/Settings/labs/{catalog,i18n}.test.ts`、`packages/business-server/src/labs/{readPoints,orphanFlags}.test.ts` | ① selector ⊆ catalog（豁免 `enableTaskVerify`）；② 服务端读取点白名单；③ 孤儿键容忍；④ i18n 完整性。                                   |
| 三、运行期 | `src/features/AdminConsole/Labs/matrix.ts` 的 `getLabRowAvailability` / `getLabRowBadges`                                 | `businessOnly` 未启用时置灰、`desktopOnly` / `workspaceOnly` 标注、selector-only 行标「无设置入口」。UI 无法断言的判定抽成纯函数单测。 |

闸门二第 2 条是源文本扫描（`preference.lab?.`、`preference?.lab?.`、`->'lab'->>`），扫描根为 `apps/server/src` 与 `packages/database/src`，文件清单与理由写在测试里，不用 AST 也不用 glob 差异。`packages/business-server/src` 刻意排除：它就是 resolver 本身。白名单每个条目还钉死了必须经过的 resolver 名，换实现同样会失败。

### 16.2 新增 lab 时的维护动作

理论上零动作。上游新增 selector 后：

1. `UserLabSchema` 变化 → 写校验与解析自动跟上（注册表就是 schema，不维护第二份列表）；
2. `/admin/labs` 矩阵自动多一行（行来自 `ALL_LAB_FEATURES` + selector 差集）；
3. 若上游同时加了 Labs 页开关，catalog、i18n 也会一起进。

闸门报警时才会需要人工，且只有两种：

- **`selector ⊆ catalog` 失败**：上游新增 selector 但没进 `ALL_LAB_FEATURES`（上游把开关放在别处，或本 fork 的 catalog 更新落后）。要么补 catalog + 文案，要么把它加进 `catalog.test.ts` 的 `NO_SETTINGS_ENTRY_SELECTORS` 并写明原因（现有唯一豁免是 `enableTaskVerify`）。
- **读取点白名单失败**：新增了直接读 `preference.lab` 的代码路径，绕过了部署解析。改成 `resolveEffectiveLabForPreference(db, preference)` 后再读；确实不能 await 的（SQL 谓词）按 `nightlyReview` 的方式接收三元态，并把文件加进 `READ_POINTS` 写清理由。

其余两项（孤儿键、i18n）失败通常说明改动本身有问题，不涉及维护动作。

### 16.3 闸门有效性验证（2026-11-25）

测试必须能真的失败，因此两个方向都反向跑过：

- 从 `ALL_LAB_FEATURES` 删掉 `enableAgentIdentity` → `catalog.test.ts` 的 `has an entry for every lab selector` 失败，失败信息点名 `enableAgentIdentity` 并指出应改的文件；恢复后 4/4 通过。
- 在 `apps/server/src/services/` 临时放入一个直接读 `preference?.lab?.enableProjects` 的文件 → `readPoints.test.ts` 报 `apps/server/src/services/__labsGateProbe.ts:2` 未走 resolver，同时 `routes every read point through its declared resolver` 失败；删除探针后 5/5 通过。

工程结果：`packages/business-server` 全量 6 文件 / 35 项测试通过；`src/features/Settings/labs/` 4 文件 / 24 项通过；改动文件 oxlint 0 error / 0 warning；`tsrs --noEmit -p tsconfig.type-check.json` 退出码 0。

## 17. CUST-010：管理控制台设备总览

只读的**机器台账**：`/admin/devices` 回答「谁有一台什么设备、在不在线」，不是个人设置设备页的复制品。管理员不做 owner 过滤 —— 他人个人设备、所有工作区设备（含 `private`）都在列表里；但**看不到设备在哪个目录干活**。维护要点见 [CUSTOMIZATIONS.md](CUSTOMIZATIONS.md) 的 CUST-010 一节，本节记录设计与偏差。

### 17.1 为什么不做写操作

无删除、无改可见性、无改别名。跨用户写会绕过上游 `self-or-owner` 门（设备归属是用户在个人设置里的事），且 `devices` 是 upsert 语义 —— 删掉下次连接自动回来。管理端在这里只承担「看见」。

### 17.2 行身份必须用真实唯一键

`devices` 的两个唯一键是 `(user_id, device_id)`（`devices_user_id_device_id_unique`）与 `(workspace_id, device_id)`。不能用 `(workspaceId, deviceId)` 一把梭：`lh connect --device-id` 可让两个 owner 用同一个 deviceId（`apps/cli/src/device/register.ts` 的 `resolveDeviceIdentity()` 在显式 id 时绕过哈希）。

因此行键是 `workspace ? ${wsId}::${deviceId} : personal:${ownerId}::${deviceId}`，详情查询把 `ownerId` 一路带到 SQL，`limit(2)` 后 `rows.length !== 1` 即 `NOT_FOUND`—— 歧义不猜。这是 T-86 的修复点：早期实现用 `personal::${deviceId}`，导致 React duplicate key，点开还可能落在他人设备上。

### 17.3 在线三态，`unknown` 不许折叠成 `offline`

| 触发                                   | 结果                                     |
| -------------------------------------- | ---------------------------------------- |
| 网关未配置（`isConfigured === false`） | 全部 `unknown`，**零请求**               |
| 探测成功且命中 deviceId                | `online`，附 `channelCount`              |
| 探测成功但池中没有该 deviceId          | `offline`                                |
| `readDeviceList` 返回 `ok: false`      | `unknown`                                |
| 探测抛错 / 超过 3s 整轮预算            | `unknown`（晚到结果由 `accepting` 丢弃） |

参数：`DEVICE_PROBE_CONCURRENCY = 5`、`DEVICE_PROBE_TIMEOUT_MS = 3000`、`DEVICE_READ_ATTEMPTS = 2`、`DEVICE_READ_RETRY_DELAY_MS = 250`。

### 17.4 唯一的上游授权偏差：`deviceGateway.readDeviceList`

上游 `readDevices` 在传输失败时回落 `queryDeviceList` 的 `[]`，管理端会把「网关没答」渲染成「这个人的设备全没上线」—— 用户明确不接受。新增的 `readDeviceList(userId, workspaceId?) → { ok: true, devices } | { ok: false, reason }` 是唯一能区分二者且不改既有调用方的接法：`queryDeviceList` 保持 `[]` 回落不变，另抽 `toDeviceAttachments()` 为纯重构。`deviceGateway` 其余文件（`routers/lambda/device/**`、`packages/device-gateway-client/**`、`packages/database/src/{models,schemas}/device.ts`、`src/features/DeviceManager/**`、`src/store/device/**`）零改动。

### 17.5 隐私白名单三层

SQL 显式列投影（不选 `defaultCwd` / `workingDirs` / `recentCwds`，`metadata` 只取 `->> 'appVersion'` 与 `->> 'cliVersion'`）→ 类型层 `ADMIN_DEVICE_DETAIL_METADATA_KEYS = ['appVersion','cliVersion']` 用 `expectTypeOf` 编译期锁死 → 渲染层 `projectDeviceDetail()` 白名单视图，抽屉只认该视图。任一层单独失效仍有兜底。

### 17.6 已知限制（不修）

- **`online` 筛选在 SQL 分页之后**：在线是活状态，SQL 表达不了。命中页可能短于 `pageSize`、`total` 仍是全量，UI 以 `isDevicePagePartial` 提示，不伪造补页。
- **`onlineStats` 只统计返回行**，非全库在线数。
- **搜索不含 deviceId**：`q` 匹配 hostname / 用户名。
- **`devices.last_seen_at` 无索引**：当前部署 8 行，跨用户全表列表 MVP 接受；数据量上来再谈索引。
- **`DEVICE_GATEWAY_URL` 配了但 `SERVICE_TOKEN` 缺失**：`getClient()` 返回 `null` → `readDeviceList` 报 `GATEWAY_NOT_CONFIGURED` → 全部 `unknown`（不会误报 offline）；上游 `queryDeviceList` 同场景仍回落 `[]`。运维上两者须成对配置。

### 17.7 上游合并检查点

1. `apps/server/src/routers/lambda/adminConsole/index.ts` 的 `...adminDeviceProcedures` spread；
2. `src/features/AdminConsole/route.tsx` 的 `devices` 子路由 + `src/routes/(main)/admin/devices/index.tsx` 一行 re-export（`desktopRouter.shared.tsx` 无需改，`/admin` 容器路由已注册）；
3. `Layout/Body.tsx` 的 `DEVICES_PATH` / `devicesActive` / `NavItem(MonitorSmartphone)` + `adminConsole` 命名空间的 `nav.devices`；
4. `packages/locales/src/default/index.ts` 的 `resources.adminConsole`—— 不注册则打包版（Electron / 无网络 SSR 首屏）拿不到该命名空间，表现为「浏览器能用、桌面首屏闪 key」；
5. `deviceGateway.readDeviceList` 与 `toDeviceAttachments` 不能被上游 `readDevices` 重构吞掉；上游若改为抛错或返回哨兵值，先确认管理端仍拿得到 `ok:false` 再删本 fork 的接法，不要两边并存；
6. 探测三参数不可调成「失败即 offline」；`resolveOnlineStates` / `tallyOnline` / `probePrincipals` 是纯函数，可被移动但语义必须保留；
7. `adminDeviceSelection` 投影与 `ADMIN_DEVICE_DETAIL_METADATA_KEYS` 是唯一 metadata 出口，上游给 `devices.metadata` 加字段时不要顺手放开；
8. 行身份必须仍是 `(user_id, device_id)` / `(workspace_id, device_id)`，上游改唯一键或 upsert 语义时重跑 `adminConsole.devices.test.ts` 的「双池互斥」与「他人 private 可见」。

## 18. CUST-008 P1 追加：物理删除用户（2026-11-26）

用户管理的最后一块写操作：管理员可以**永久删除**普通账号，账号及其全部数据一起消失；`admin` 角色与操作者自己不可删除。删除后邮箱 / SSO 身份不再被占用，对方可重新注册或单点登录得到全新账号。没有软删除、没有墓碑表、没有黑名单。

### 18.1 规则

| 目标                                     | 结果                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| 操作者自己                               | `SELF_LOCKOUT`（保留行，不做任何清理）                            |
| `users.role = 'admin'`（含已禁用管理员） | `ADMIN_PROTECTED`；先撤管理员，撤权本身已保证至少留一个启用管理员 |
| 普通用户                                 | 物理删除；`users` 行、级联数据、对象存储中的独占文件全部清掉      |
| 不存在 / 已被别人删掉                    | `USER_NOT_FOUND`                                                  |
| 该账号仍有进行中的 agent 迁移            | `AGENT_TRANSFER_PENDING`；等迁移排空后重试                        |

### 18.2 实现

- **级联复用上游账号注销路径**：`AdminConsoleModel.deleteUser` 调 `UserModel.deleteUser`，不手写 `delete from users`。后者已覆盖 `users` FK cascade 到不了的表（share 访客 `topics.senderId`、个人 `channels`、个人 `task_labels`、project environments、goal 图），并自带 pending agent-transfer 守卫。
- **守卫在事务内复核**：`UserModel.deleteUser` 新增可选 `assertDeletable(tx)`，在锁住账号行之后、级联之前执行。管理端在这里重新读角色（复用 `admin_console:last_admin` advisory lock，与改角色 / 禁用串行），所以「先查不是管理员、随后被提权、再被删」这条竞态被关掉。
- **对象存储**：`files` 行随 cascade 消失，SQL 看不见 S3 对象。`apps/server/src/services/adminConsole/userDeletion.ts` 在删除前快照该账号的 `files`，删除后只回收「已无其他 `files` 行引用」的对象及其 `global_files` 行；`DISABLE_REMOVE_GLOBAL_FILE=0` 时保留对象，与既有删除语义一致。对象回收失败只记日志，不回滚账号删除（残留对象可回收，半删账号不可接受）。
- **接口**：`adminConsole.deleteUser({ userId })`，`adminProcedure`，返回 `{ deletedFiles, removedObjects }`。原生 `/api/auth/admin/*` 仍返回 404，删除入口只有控制台。
- **文案**：`adminConsole` 命名空间新增 `users.delete.*`（en-US /zh-CN 同 PR 手写）。

### 18.3 页面

用户详情抽屉底部新增「危险操作」区：正常情况下要求输入 `username`（缺失时用邮箱）才能点亮红色「永久删除用户」，再经 `confirmModal` 二次确认；删除成功后关闭抽屉并刷新列表，不重新拉取已删除的用户详情。`admin` 目标与操作者自己只显示原因，不显示输入框。

### 18.4 验收要点

1. 删除普通用户后：列表不再出现；`users` / `auth_sessions` / `api_keys` / `files` 行均无；对象存储中其独占文件被回收。
2. 同一邮箱可再次注册；SSO 工号再次登录会创建新用户（新 `users.id`）。
3. 对自己与任意管理员（含已禁用）不出现输入框；直接调接口返回 `SELF_LOCKOUT` / `ADMIN_PROTECTED`。
4. 普通用户直接调 `adminConsole.deleteUser` 返回 `ADMIN_REQUIRED`。

### 18.5 上游合并检查点

1. `UserModel.deleteUser` 的 `assertDeletable` 钩子必须保留在行锁之后、级联之前；上游重写该方法时先迁移该钩子再合并。
2. `AGENT_TRANSFER_PENDING_OWNER_DELETE` 常量与守卫不能被吞掉，管理端靠它给出可读错误。
3. `global_files.creator` 的 `ON DELETE SET NULL` 与 schema 里的 `notNull()` 漂移（实际库可空）—— 若上游补上 NOT NULL，必须先删 / 转移共享 `global_files` 行，否则删除曾上传过共享文件的账号会失败。
4. 删除后不得新增墓碑或唯一约束，否则「重新注册 / SSO 重建」失效。
