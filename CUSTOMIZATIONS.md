# 二次开发功能清单与上游合并指南

这是本 Fork 所有二次开发的统一入口，后续不限于 TFS。每次增加、修改或移除定制功能，都在这里登记；复杂功能另有详细说明，并从本清单链接。合并上游前先读本文件，不能仅靠 Git 自动合并成功判断功能还在。

记录日期：2026-11-16；初始开发基线：`canary` / `871dce63b7`。历史项依据本地可见提交与当前代码核对；不把上游原有功能认作本 Fork 二开。TFS 及本轮部署补充随包含本文的代码提交交付；镜像发布状态以 Actions 为准，目标服务器部署及验收另行核实。

## 功能总表

| 编号     | 二开功能                            | 用户入口 / 行为                                                                                        | 维护位置                                                                                                                                                                                                                                    | 状态                                                                          |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| CUST-001 | 自定义 Docker 镜像发布              | main /canary 推送及手动 Actions 发布本 Fork 的 GHCR 镜像；当前 Linux amd64                             | `.github/workflows/publish-custom-image.yml`                                                                                                                                                                                                | 历史已有；本轮增加 TFS curl 构建参数                                          |
| CUST-002 | 单文件安装 / 更新管理器             | `bash deploy-custom-image.sh`；新机安装、切换 main/canary/ 自定义镜像、更新应用或恢复完整栈            | `scripts/deploy-custom-image.sh`、[部署说明](scripts/deploy-custom-image.md)                                                                                                                                                                | 历史已有；本轮增加 TFS 缺省地址、更新后结算并自动重跑中断会话                 |
| CUST-003 | 部署脚本接入 Onlyboxes / Market     | 菜单切换、保留配置；从一次性应用容器真实探测 Onlyboxes JIT 与 terminalExec                             | 同上；`scripts/deploy-custom-image.test.py`                                                                                                                                                                                                 | 历史已有；仅登记脚本接入，Onlyboxes provider 本身不算本项新增                 |
| CUST-004 | Fork 发布工作流隔离                 | 官方专用发布 / 同步任务在 Fork 默认跳过，防止误执行官方发布路径                                        | 下方列出的五个 `.github/workflows/` 文件                                                                                                                                                                                                    | 历史已有                                                                      |
| CUST-005 | 个人 TFS / Azure DevOps Server 接入 | 设置 → TFS / Azure DevOps 绑定个人身份；从 TFS 建项目；环境 Git 来源；PR / 构建 / 发布 / TFVC 只读浏览 | 独立 `tfs` 模块；设置页 `src/features/Tfs/SettingsPage.tsx`；[详细维护说明](TFS_CUSTOMIZATION.md)                                                                                                                                           | 本次新增，REST / 本机 Git 已实测，产品页面和部署验收待完成                    |
| CUST-006 | Fork CLI npm 发布                   | canary 推送或手动 Actions 发布 `@lichao0223/lobehub-cli`；本机命令仍为 `lh`                            | `.github/workflows/release-cli.yml`、`apps/cli/package.json`                                                                                                                                                                                | 本次新增；需要 Fork 自己的 npm Token                                          |
| CUST-007 | 统一认证平台 SSO\_TICKET 接入       | 门户菜单免登：`/api/auth/sso-ticket/callback` 换票、按工号建用户并建立本地会话                         | 独立 `sso-ticket` 插件目录；[详细维护说明](SSO_TICKET_CUSTOMIZATION.md)                                                                                                                                                                     | 开发中；单测已交付，待与真实认证中心联调                                      |
| CUST-008 | 管理员控制台（P1 / P2 已交付）      | `/admin`：用户管理（列表 / 搜索 / 禁用 / 设撤管理员 / 撤会话）；P2 模型服务（Tellhow 内置厂商）        | [设计、实现清单与偏差](ADMIN_CONSOLE_DESIGN.md)、`prototypes/admin-console/`                                                                                                                                                                | P1 已落地（2026-11-23）；P2 已验收并合入 canary（2026-11-24）                 |
| CUST-009 | 管理员统一实验室（Labs）开关        | `/admin/labs` 一处设定全站 lab；普通用户看不到 Labs 设置页，启用的实验全站生效                         | `packages/business-server/src/labs/`、`packages/business-server/src/adminConsole/labs.ts`、`src/features/AdminConsole/Labs/`、[设计](ADMIN_CONSOLE_DESIGN.md#16-cust-009管理员统一-labs-开关)                                               | 已验收并合入 canary（2026-11-25，`2bcbbb2bfc`）                               |
| CUST-010 | 管理控制台设备总览（只读，跨用户）  | `/admin/devices`：全库设备台账（含他人 private、工作区设备），筛选 / 搜索 / 分页 + 详情抽屉 + 在线三态 | `src/features/AdminConsole/Devices/`、`apps/server/src/routers/lambda/adminConsole/devices.ts`、`packages/database/src/models/adminConsole.ts`、[设计](ADMIN_CONSOLE_DESIGN.md#17-cust-010管理控制台设备总览)                               | 已合入 canary（2026-11-26）；接口级验证通过，UI 截图与 `unknown` 真机证据待补 |
| CUST-011 | 管理员默认值（全站模型默认）        | `/admin` 模型服务「默认值」：chat / title / verify / embedding 成为全站默认模型                        | [设计与语义](ADMIN_CONSOLE_DESIGN.md#71-默认值解析cust-011)、`packages/business-server/src/companyProvider.ts`、`packages/business-server/src/adminConsole/serviceDefaults.ts`、`packages/business-server/src/adminConsole/modelService.ts` | 后台任务兜底已接入（T-91）；前端对齐（T-93）、真实验收（T-94）进行中          |

## CUST-001：自定义镜像

- 镜像名称由 `ghcr.io/${{ github.repository }}` 生成；当前部署脚本默认 `ghcr.io/lichao0223/lobehub`。main/canary 和 SHA 标签支持复现与切换，手动运行可指定标签及是否移动 latest。
- 保留工作流的 GHCR 写入权限、登录、标签规则、Dockerfile 构建及缓存。目前平台为 `linux/amd64`，不能承诺 ARM 镜像。
- 本轮在本 Fork 发布工作流传入 `INSTALL_TFS_CURL=true`；根 `Dockerfile` 保留可选安装，复制 NTLM curl **及动态库到最终 distroless 运行层**。仅 builder 安装 curl 无效；不要求用户进入容器安装。
- curl 二进制、依赖和加载器放在独立 `/opt/tfs/`，`/usr/bin/curl` 入口通过该加载器启动。不能覆盖 BusyBox 的 `/lib/libc.so.6`，否则系统 shell 可能因 `GLIBC_2.38 not found` 无法启动；也不能用 `cp --parents` 生成顶层 `/lib64` 目录，与 BusyBox 的同名链接冲突。发布工作流先生成最小运行镜像，执行 Dockerfile 中实际的用户创建和权限设置命令，并以非 root 用户验证 Node 和 NTLM curl，再做完整构建。
- 历史依据：`e3c84a0ad6`、`991d1466f7`。上游重构 Docker 多阶段构建时，要重新确认安装参数、最终复制路径和非 root 用户执行权限。
- 检查：Actions 构建成功、目标标签指向正确 SHA；在目标镜像运行 `docker run --rm --entrypoint /usr/bin/curl <镜像:标签> --version`，输出含 `NTLM`。此镜像构建检查本机尚未执行。

## CUST-002：部署管理器

- 同时维护单文件脚本、Markdown 使用说明、Python 行为测试和 `.github/workflows/test-deploy-script.yml`。服务器只下载一个脚本，不依赖仓库 Python 模块。
- 首次安装下载同分支的 `docker-compose/deploy/` 配套文件；生成独立数据库 / S3 / 认证 / KeyVault 密钥和 RSA JWKS；已有部署不重新生成密钥、不重写 `.env`。
- 选择保存在脚本管理的标准 Compose override；保留其他环境变量、处理 `$` 插值；不覆盖用户自建的 override。更新前备份配置；拉取失败不切换，启动失败恢复旧 override。配置备份不包含数据库、卷或数据库迁移回滚。
- 本轮预制 `TFS_COLLECTION_URL=http://dev.tellhowsoft.com/DefaultCollection`、`TFS_API_VERSION=6.0`。首次安装写入 `.env`；更新已有部署仅在 Compose 有效环境未定义对应键时补进托管 override。已有自定义值和空字符串禁用值都保留，不生成共享 TFS 用户名 / 密码。
- 如果旧安装的缺省值已经写入托管 override，后续改 Collection / 禁用 TFS 要编辑该 override 的对应环境项，或删除这两个项后在 `.env` 配置；override 的优先级高于 `.env`。全程保留文件的托管标记和其他配置。
- `KEY_VAULTS_SECRET` 是 LobeHub 自己已有的加密密钥，不从 TFS 申请。首次安装脚本用 32 个随机字节生成并写入部署目录 `.env`；也可能来自原先的 `docker-compose/setup.sh`。更新时沿用原值。若缺失应先核查旧配置和备份，不能拿新密钥覆盖旧数据的密钥。
- 更新已有部署会在 `up -d --wait` 成功后自动结算运行中的任务（`SETTLE=1` 默认；`0` 关闭，`dry-run` 只预览）：把挂在运行中任务上的操作改为 `interrupted` 并回拨 `updated_at` 20 分钟，用 `KEY_VAULTS_SECRET` 自签内部回调触发 `/api/workflows/task/watchdog` 让任务转 `paused`，再逐个 `POST /api/agent/finalize-abandoned`（Bearer `AGENT_GATEWAY_SERVICE_TOKEN`）兜底残留聊天。依赖应用、Gateway 与 PostgreSQL 已就绪；结算失败只告警，不让部署失败，失败项保持 `running` 等下一次看护收敛。首次安装不执行。
- 更新后自动重跑被中断的会话（`RESUME_AFTER_DEPLOY`，默认 `1`；`0` / `off` / `false` / `no` 关闭，关闭时仍照常结算）：结算前先在 `deploy_resume_queue` 里登记「本次更新打断的会话」，新容器启动时由启动恢复器重跑。清单在把 op 标 `interrupted` **之前**写入，只登记真正在跑的（`agent_operations.status IN ('idle','running',…)`，任务侧还要求 `task_topics.status='running'`）；已 `waiting_for_human` 超过 24 小时的陈留运行不登记。`SETTLE=0` 与 `SETTLE=dry-run` 都不写清单。写入失败只告警，不影响结算与部署结果。
- 待恢复清单表 `deploy_resume_queue`（`packages/database/src/schemas/deployResumeQueue.ts`，迁移 `9000_nosy_tag.sql`）字段：`kind`(`task`/`chat`)、`status`(`pending`/`running`/`done`/`failed`/`skipped`)、`taskId`、`topicId`、`operationId`、`userId`、`workspaceId`、`payload`(jsonb：`lastUserMessage`、`settledAs`)、`attempts`、`error`、`resumedAt`。索引 `(status, created_at)`；**唯一索引 `topic_id`** 保证同一会话只恢复一次，重复部署用 `ON CONFLICT (topic_id) DO UPDATE` 就地重置为 `pending`（`attempts=0`、`error=NULL`、`resumed_at=NULL`）。`user_id` / `workspace_id` 故意不建外键，避免容器停机期间删用户 / 删工作区导致登记失败。
- Fork 自定义数据库迁移统一使用 `9000+` 编号保留区：文件名与 journal `idx` 都落在 9000+（当前 `9000_nosy_tag` 的 `idx` 是 9000），条目永远排在 journal 尾部。drizzle-kit 用「最后一条 `idx` + 1」命名新迁移，所以 fork 后续迁移自动是 9001、9002…，不会占用上游编号；运行时 drizzle-orm 只按 journal 数组顺序执行，并以 `when` 与 `__drizzle_migrations.created_at` 比较判定是否已应用，`idx` 不参与执行判定，所以大编号不改变迁移顺序。
- 上游合并后运行 `bun run db:fork:reconcile`（`scripts/fork/reconcileMigrations.ts`）：把 fork 条目固定到队尾、保证其 `when` 晚于全部上游条目，并按「上游最新快照 + fork 表」重建 `9000_snapshot.json`。`--check` 只检查、需要修复时退出码 1。新增 fork 表时要同步脚本里的 `FORK_TABLES`。
- **绝不把 fork 条目的 `when` 改成未来常数**：判定是「`when` 大于已应用的最大 `created_at` 才执行」，未来值会让之后所有上游迁移被永久静默跳过。只需要保证它比当时最后一条上游条目大 1ms（脚本会在合并后自动修正）。
- 启动恢复器 `apps/server/src/services/deployResume/`（`resumePendingDeployResumes` → `resumeDeployInterruptedRuns`）：在 `src/instrumentation.ts` 的 `register()` 里挂载，条件 `NEXT_RUNTIME==='nodejs' && DATABASE_URL && !VERCEL_ENV && RESUME_AFTER_DEPLOY !== '0'`，写法与既有 `resumePendingAgentTransferJobs` 一致，**catch + log，绝不阻塞启动**。单次启动最多取 20 条（`MAX_PER_BOOT`），并发 5（`CONCURRENCY`），单行最多 3 次尝试（`MAX_ATTEMPTS`），退避 5s（`RETRY_DELAY_MS`），超过 24 小时的陈旧 `pending` / `running` 直接标 `skipped`（`STALE_AFTER_MS`）。跨进程互斥靠数据库 `claim`（`UPDATE … WHERE status='pending'`），同进程另有 `running` Set 防重入。
- 任务恢复复用它自己的服务层入口：`TaskRunnerService.runTask({ taskId, continueTopicId: topicId, extraPrompt: '上一轮因部署更新中断，请先检查已完成部分，再继续未完成的工作。', trigger: 'deploy-resume' })`。`trigger` 新增取值 `'deploy-resume'`（`packages/types/src/task/index.ts`、`task_topics.trigger`、`locales` 的 `taskDetail.runTrigger.deploy-resume`），语义同 `manual`：不消耗定时配额、失败不自动 pause。结算后 topic 已是 `canceled`，`runTask` 的「topic 非 running」前置校验因此放行；成功后往话题插一条「因部署更新中断，已自动继续。」提示（仅首次尝试写，避免重试刷屏）。
- 普通对话恢复走服务层 `startComposerRun`（`apps/server/src/services/aiAgent/composerRun.ts`），**不是** HTTP 自调用 `execAgent`；等价于 UI「重试」：重发 topic 最后一条 `role='user'` 消息（优先用清单里的 `payload.lastUserMessage` 快照，缺失才回查库）。跳过条件：topic 已不存在、关联 op 已是 `done`、topic 已有 live run、op 最后一条 assistant 已是完整回答（登记时 `settledAs` 已区分任务运行与残留聊天）。
- 上游改动需同步检查的接点：`scripts/deploy-custom-image.sh` 的 `reconcile_runs()` / `settle()` 顺序、`src/instrumentation.ts` 的启动块、`TaskRunnerService.runTask` 的签名与 `TaskRunTrigger` 联合类型、`startComposerRun` 的参数形态，以及 `agent_operations` 的 `IN_FLIGHT_STATUSES` 常量。上游若给 `task_topics` 加 `trigger` 枚举约束（当前是 `text().$type<>`），要补迁移。
- 尚未覆盖的边界：只重跑一轮，不做断点续传；多副本同时启动靠 `claim` 只会有一个容器跑；`SETTLE` 未开启的部署（`SETTLE=0`）不会登记；计划任务 / 心跳在下一次 tick 自然恢复，不走本清单；恢复计费不设防（自用部署，用户明确要求全开）。
- 历史依据：`e3c84a0ad6`、`d0b8fa56a2`、`20b371eeb8`、`ecd6a41479`、`a574f77ca9`。后两项分别修复 Compose `$` 反转义和终端不可 seek 的输入问题，合并时不要丢。
- 上游改变服务名、Compose 模板位置、启动命令或健康检查时，同步检查脚本的 `SERVICE`、模板清单和 `--wait` 流程。镜像发布与部署脚本更新是两件事：本地改源码后，服务器拉取旧标签不会得到新功能。
- 脚本只升级应用服务：更新路径是 `compose pull $SERVICE` + `up -d --wait --no-deps $SERVICE`，`gateway` / `postgres` / `redis` / `rustfs` / `searxng` 既不拉取也不重建；已有部署的基线 `docker-compose.yml` 只备份不重写。这些服务的版本完全由 `docker-compose/deploy/docker-compose.yml` 的 pin 决定（首次安装下载该模板，之后需手动改 tag 再 `docker compose up -d <service>`）。当前 pin：`ghcr.io/lobehub/lobehub-gateway:0.5.3`（`docker-compose/deploy` 与 `docker-compose/eval` 同步；升级原因：0.5.1 修设备磁盘指标，0.5.2/0.5.3 修断线 replay/resume）。Go 网关不支持 admin API 与 device tunnels，端口分享入口仍会读不到链接，与版本无关。

## CUST-003：Onlyboxes / Market 部署切换

- 菜单 5 填写 Console 基础 URL、与 Console 一致的 JIT 签名密钥、issuer；菜单 6 检查当前配置。菜单 7 可启动或恢复依赖服务。
- 通过待部署镜像的一次性容器、相同 Compose 网络与环境，签发 JIT 并执行真实 terminal 命令。探测失败不改配置，不重启应用；不是判断本机是否有同名容器。
- 切回 Market 清空托管的 Onlyboxes 参数。Onlyboxes Console /worker 要另行部署，脚本不安装它们；探测不覆盖文件导出所需的 terminalResource。
- 历史依据：`20b371eeb8`。上游修改 Onlyboxes 请求协议、JIT claim、签名、路径或启动参数时，同步修改脚本内 `ONLYBOXES_PROBE` 和协议测试；不能只更新应用 provider。

## CUST-004：Fork 工作流隔离

以下工作流保留 `github.repository == 'lobehub/lobehub' || vars.ENABLE_UPSTREAM_PUBLISH_WORKFLOWS == 'true'` 的执行条件及原有附加条件：

- `.github/workflows/sync-main-to-canary.yaml`
- `.github/workflows/deploy-workbench.yml`
- `.github/workflows/release-desktop-canary.yml`
- `.github/workflows/release-model-bank.yml`
- `.github/workflows/release-sdk.yml`
- `.github/workflows/preview-cli.yml`

历史依据：`f0512669c3`、`2b97b25170`。上游重命名或拆分这些工作流时迁移条件；启用开关前配置相应发布凭据。不要把此限制加到本 Fork 自己的 Docker 镜像发布或常规代码测试上。

## CUST-005：TFS

完整功能、文件、配置、安全边界及实测记录见 [TFS\_CUSTOMIZATION.md](TFS_CUSTOMIZATION.md)。合并时至少保持：

1. 独立服务、RPC、前端 service /store/ UI 模块与共享类型；既有项目 / 环境表单中的接点和 en-US /zh-CN 文案。
2. 每位用户一个个人 TFS 身份，同一外部身份也只能绑定一位用户；身份由服务端确认并经既有 KeyVault 加密，不复用他人凭据。
3. 项目创建、绑定仓库、环境创建、环境更新及运行初始化均验证当前用户权限；固定 Collection、URL 校验、不跟重定向、日志脱敏和登出缓存清理。
4. 复用既有 SCM identity 表与唯一约束，当前无需 migration。上游如调整这些表和加密格式，需要迁移兼容方案，不能简单删字段。
5. 代码只初始化到个人工作目录或临时沙箱；公共网盘和旧实例构建入口尚不支持 TFS。详见 TFS 文档的使用限制，不能将 “可保存来源” 误当成 “所有执行方式都已支持”。
6. 本 Fork Docker 工作流的 NTLM curl 构建参数、部署脚本的缺省 Collection/API 配置。
7. TFS 独立的 agent 仓库上下文与云端 CLI 提示：普通服务端 / 浏览器运行、云端 CLI、连接设备 CLI 和桌面本地 CLI 都能读取当前作用域允许的地址、分支与环境；旧对话也按当前项目关联读取。GitHub 的 `GITHUB_REPOS`、预克隆和认证流程保持原逻辑。公开 TFS 项目来源的自动检出使用调用者个人盘，旧的自动项目目录在运行时纠正；手选公共目录仍禁止 TFS 检出。
8. 市场 → 应用里的 TFS 入口卡片：`Marketplace/Apps/catalog.ts` 的 `TFS_APP_ID` 合成条目与 `getAppHome` 跳转、`useMarketplaceApps.ts` 传入的 `tfsConnected`、`AppIcon.tsx` 的图标分支，以及 `apps.summary.tool.tfs` 的 default /en-US/zh-CN 文案。卡片只做入口，绑定与解绑仍在 `/settings/tfs`，不复制 `AppDetail` 渲染；`tfs` 故意不进 `WORKSPACE_SETTINGS_TABS`，因为绑定属于个人而非工作空间。上游重构应用目录时逐个接点复查，不能让卡片消失或退回「无连接」状态。

### TFS 权限与后续 Git 操作补全（2026-11-16）

- 个人设备上的 TFS checkout 会把临时 Git credential helper 随本次 agent 请求传给设备 CLI，后续普通 `fetch`、`pull`、`push` 命令继承同一认证环境。设备必须运行包含该协议字段处理的本 Fork CLI，旧 CLI 会完成首次 checkout 但不会为后续 Git 操作注入凭据；共享设备和工作区设备仍不接收个人凭据。

- 共享 agent 仓库上下文排除调用者私有环境，覆盖 Topic 和无 Topic 任务；GitHub 上下文不改。

- 新增独立 `tfs.git/gitOperation`、`lh tfs git` 和随服务端交付的 TFS CLI shim。后续云端 fetch / 快进 pull / 非强制 push 按当前调用者重新授权，只操作当前 Topic 选中来源，凭据不返回 agent、不落 Git 配置；临时沙箱可用，实际公共盘和旧实例继续拒绝。

- 合并时保留 `services/tfs/{git,gitCommand,cliShim}.ts`、`routers/lambda/tfsGit.ts`、`apps/cli/src/commands/tfs.ts`，以及普通云端 `lh` 预处理和 TFS CLI 启动的派发接点。详细协议、测试和待验收项见 TFS 说明。

- 2026-11-19 上游合并后的沙盒初始化继续区分临时沙盒与公共持久目录：临时沙盒允许调用者个人 TFS 凭据初始化，workspace public drive 拒绝 TFS 克隆和后续 Git 操作；公共盘判断在统一 `resolveSandboxSessionConfig` 路径回归覆盖。

## CUST-006：Fork CLI 发布

- npm 包名是 `@lichao0223/lobehub-cli`，避免占用官方 `@lobehub/cli`。三个本机命令别名仍保留为 `lh`、`lobe`、`lobehub`，因为设备 agent 和连接服务依赖当前可执行入口。
- `.github/workflows/release-cli.yml` 仅在 `lichao0223/lobehub` 的 `canary` 分支运行发布 Job。发布前读取 Fork 包自己的 npm 版本记录，创建 `cli-release/v*` 版本预留标签，构建、打包、发布并校验 npm latest。
- 合并上游 CLI 发布工作流时保留 Fork 的仓库条件、包名、`.tgz` 通配符和 `NPM_TOKEN` 配置。官方包名与官方发布条件不能恢复。

### TFS 仓库上下文补全（2026-11-16）

- 主要实现位于 `apps/server/src/services/tfs/{agentContext,cloudAgentContext,projectCheckout}.ts`；共享运行链路只增加调用接点。桌面 / 浏览器通过 workspace-aware 的 `tfs.agentContext` RPC 获取无凭据上下文，RPC 保留 topic 可见性和 agent-share 访客隔离检查。
- 上下文区分 “项目已关联来源”“对话选中环境” 和 “实际已检出代码”；不宣称元数据等于克隆成功，不把密码 / PAT 或环境变量发给模型。调用者自己的网关管理设备只在空工作目录首次调用时用一次性凭据初始化，初始化成功后同一运行上下文的普通 Git 命令继承临时配置；共享设备、桌面直连和其他未完成个人初始化的命令继续使用设备自身凭据管理器。
- 尚无实际部署的页面 /agent 对话验收；自动化验证及当前边界见 TFS 详细说明。合并时保留浏览器上下文、桌面本地 CLI、服务端运行和云端 / 设备分发的所有接点。

## CUST-008：管理员控制台（P1 已交付，P2 进行中）

完整方案、数据模型、侵入清单与实施偏差见 [ADMIN\_CONSOLE\_DESIGN.md](ADMIN_CONSOLE_DESIGN.md)；可点击原型见 `prototypes/admin-console/index.html`。P1 分支：`feat/admin-console-p1`（2026-11-23）。验收报告：<http://192.168.14.51:3210/acceptance/89de762f-0f6f-4794-8b27-1eefd95cd09a> （8/8 passed）。

### P1 交付内容

- **数据库**：fork 保留区迁移 `9001_admin_console_settings.sql` 新增单行表 `admin_console_settings`（`id='singleton'`、`config jsonb`、`updated_by`、时间戳）。**0 个上游表结构变更**；`scripts/fork/reconcileMigrations.ts` 的 `FORK_TABLES` 已补该表。
- **业务层**：`packages/business-server/src/adminConsole/permissions.ts`（`isAdminRole`、环境变量名单惰性提权、`adminProcedure`、最后管理员串行锁）；`packages/database/src/models/adminConsole.ts`（列表 / 详情 / 改角色 / 禁用 / 解禁 / 撤会话）；`packages/types/src/adminConsole.ts`。
- **接口**：`adminConsole` router 挂到 `apps/server/src/routers/lambda/index.ts`。`whoami` 用 authed；`listUsers` / `getUser` / `setUserRole` / `banUser` / `unbanUser` / `revokeUserSessions` 用 admin。账号状态只写 Better Auth 已有的 `users.role` / `banned` / `banReason` / `banExpires`，不新增 `is_admin` 列。
- **页面**：`src/features/AdminConsole/*`；`/admin` 注册在 `src/spa/router/desktopRouter.shared.tsx`（`preloadId: 'adminConsole'`），`/admin/users` 为兼容别名；用户菜单入口在 `src/features/User/UserPanel/useMenu.tsx`，仅管理员渲染。移动端不注册。
- **原生端点拦截**：`src/app/(backend)/api/auth/[...all]/route.ts` 对 `POST /api/auth/admin/*` 返回 404（规则在 `src/libs/better-auth/adminEndpointGuard.ts`），保证账号状态唯一写入口是 `adminConsole.*`（§12.6）。
- **环境变量**：`ADMIN_CONSOLE_BOOTSTRAP_EMAILS`（邮箱或用户名，逗号分隔，大小写不敏感）、`ADMIN_CONSOLE_BOOTSTRAP_USER_IDS`。命中且当前非 admin、且「实例无启用 admin」或「从未 bootstrap」时惰性提升为 admin；只升不降，名单移除不自动降权。
- **文案**：`packages/locales/src/default/{common,setting}.ts` 与 `locales/en-US|zh-CN/{common,setting}.json`。

### 共享文件改动（§8.2）

| 文件                                              | 改动                                           |
| ------------------------------------------------- | ---------------------------------------------- |
| `apps/server/src/routers/lambda/index.ts`         | +2，挂载 `adminConsole`                        |
| `src/spa/router/desktopRouter.shared.tsx`         | +4，注册 `/admin`                              |
| `src/features/User/UserPanel/useMenu.tsx`         | +3，菜单入口接线                               |
| `src/features/NavPanel/routeKey.ts`               | +5，`admin → admin` 单点映射（控制台自有侧栏） |
| `src/app/(backend)/api/auth/[...all]/route.ts`    | +7，拦截原生 admin 端点                        |
| `packages/database/src/index.ts`                  | +1，导出 model                                 |
| `packages/database/src/schemas/index.ts`          | +1，导出 schema                                |
| `packages/database/migrations/meta/_journal.json` | +7，注册 9001                                  |
| `packages/types/src/index.ts`                     | +1，导出类型                                   |
| `packages/locales/src/default/common.ts`          | +2                                             |
| `packages/locales/src/default/setting.ts`         | +60                                            |
| `locales/{en-US,zh-CN}/{common,setting}.json`     | 各 +2 / +58                                    |
| `scripts/fork/reconcileMigrations.ts`             | `FORK_TABLES` +1 项（其余为格式化）            |

§8.2 原列 8 个文件只覆盖 P2 运行时接点；P1 实际超出清单的都是**注册类单点追加**（包入口导出、迁移 journal、i18n 文案、鉴权拦截、NavPanel key）。逐项理由与验收口径见设计文档 §15；没有修改上游表结构、`src/features/Settings/**` 或 `updateSettings` 策略。

### 上游合并时必须保留

1. 迁移 9001 保持在 journal 队尾、`idx` 在 9000+ 保留区；合并上游后跑 `bun run db:fork:reconcile`。
2. `adminConsole` router 挂载、`/admin` 路由 / `preloadId` / 菜单入口、`whoami` 守卫。
3. `users.role` 仍是唯一管理员来源；不新增 `is_admin`，不启用 Better Auth 原生 `/api/auth/admin/*`。
4. 禁用级联顺序：① `api_keys.enabled=false` → ② 写 `banned` / `banReason` / `banExpires` → ③ 尽力撤 session。**解禁不恢复 API Key**。
5. 最后管理员保护（`pg_advisory_xact_lock(hashtext('admin_console:last_admin'))`）与自助操作 `SELF_LOCKOUT` 的 `CONFLICT` 语义。
6. en-US /zh-CN 文案与 en-US 源文案同步；上游改 `users` 表、`api_keys` 或 Better Auth admin 插件时会话字段时逐项复查。
7. `src/proxy.ts` 的 matcher 保留 `/admin` 与 `/admin/(.*)`：否则 `/admin` 深链会被 Next 的 not-found 重定向回首页，控制台只在 SPA 内部跳转时可用。

### P2（进行中）

- 2026-11-24（T-55，P2-1）：`packages/model-bank/src/modelProviders/tellhow.ts`（`id: 'tellhow'`、名称经 `modelProvider:tellhow.title` 本地化、`showConfig: false` / `proxyUrl: false` / `showApiKey: false` / `disableBrowserRequest: true`，用户侧无密钥与地址入口）与 `src/aiModels/tellhow.ts`（空目录，运行时由管理员目录注入）已落地；`ModelProvider.Tellhow` 追加；共享文件 +1（`aiModels/index.ts` 导出）、+1（`const/modelProvider.ts`）、+3（`modelProviders/index.ts` 的 import / 列表注册 / 公开导出）；`packages/model-runtime/src/runtimeMap.ts` 将 tellhow 映射到 `LobeOpenAI`（OpenAI 兼容）。

- 文案：`packages/locales/src/default/modelProvider.ts` 与 `locales/{en-US,zh-CN}/modelProvider.json` 增加 `tellhow.title`；provider card 的 `name` / `description` 使用 `modelProvider:tellhow.title` / `providers:tellhow.description` 键（不写字面量），默认说明文本由 `packages/locales/src/default/providers.ts` 提供，en-US /zh-CN 在 `providers.json` 手写 `tellhow.description`。

- **P2-2 `config.ai`（已实现，2026-11-24）**：`packages/types/src/adminConsole.ts` 增加 `AdminConsoleAiConfig` / `AdminConsoleAiConfigView` / `AdminConsoleAiKey` / `AdminConsoleAiDefaults` / `AdminConsoleAiLastTest` / `CompanyModel`（`type` 复用 `model-bank` 的 `AiModelType`）。`packages/business-server/src/adminConsole/modelService.ts` 负责校验（http (s) baseURL、模型 id 唯一、类型属于 `AiModelType`）与写入；API Key 复用 `apps/server/src/modules/KeyVaultsEncrypt` 加密，只把 `last4` 返回给管理端。设置行仍写 P1 的 `admin_console_settings` 单例；P2 将 settings 方法提取为 `AdminConsoleSettingsModel`（`AdminConsoleModel` 继承它），`updateSettingsConfig` 用 `updatedAt` 做乐观锁，过期返回 `CONFLICT` / `CONFIG_CONFLICT`。接口 `getModelServiceConfig` / `updateModelServiceConfig` 挂在 `adminConsole` router 的 `adminProcedure` 下；**不新增迁移，不写 `user_settings`**。

- 新增文件：`packages/business-server/src/adminConsole/modelService.ts`、`apps/server/src/routers/lambda/adminConsole/modelService.ts` 及其单测。`packages/business-server/package.json` 增加 `model-bank` 依赖（校验枚举用）。

- 单测覆盖：KeyVault 密文落库与 `last4` 脱敏、类型 / 地址 / 重复 id / 默认模型校验、乐观锁冲突、tRPC 响应不含明文或密文、非管理员 `ADMIN_REQUIRED`、`user_settings` 三列不变。

- **P2-3 `companyProvider` 与运行时注入（已实现，2026-11-24）**：新增 `packages/business-server/src/companyProvider.ts`，作为 `config.ai` 的唯一读取层 —— 单例行 + `KeyVaultsGateKeeper` 解密，5 s 进程内缓存（并发共享一次读，读失败保留上次成功配置），只输出 `open && !removedAt` 的模型；`enabled: false` / 缺地址 / 缺密钥一律为 `null`（默认关闭）。同步快照 `getCompanyProviderRuntimeSnapshot()` 供 `getParamsFromPayload`（保持同步、签名不变）使用，`resolveCompanyProviderParamsOrThrow()` 负责「有配置就注入、关闭就抛可读错误」；`initModelRuntimeFromDB` 先 `ensureCompanyProviderReady()`（仅 tellhow 触发读库）。凭据优先级：payload 自带 > 控制台 > `TELLHOW_API_KEY` / `TELLHOW_PROXY_URL` > `NoAvailableProvider` 可读错误（400 + 固定文案，提示切换模型）；用户自带 baseURL 时绝不附带公司 Key。`withCompanyProviderCatalog()` 合并 `aiProvider.tellhow.enabled` / `enabledModels` / `serverModelLists`（`fetchOnClient: false`），`globalConfig` 只加一处调用；保存配置后 `invalidateCompanyProviderCache()` 立即生效。新增 `companyProviderFetch()`（`ssrfSafeFetch` + 本条地址放行，IP 进 `allowIPAddressList`、域名仅该次调用允许内网），供 P2-4 的测试连接与目录同步复用。

- 共享文件（P2-3）：`apps/server/src/globalConfig/index.ts` +4/−1、`apps/server/src/modules/ModelRuntime/index.ts` +23/−3（import 5、`canUseServerProviderConfig` 5/−3、tellhow 分支 9、预热 4，均 ≤10 行 / 处）。新增依赖：`packages/business-server` 增加 `@lobechat/ssrf-safe-fetch`。

- 单测（P2-3）：`apps/server/src/modules/ModelRuntime/companyProvider.test.ts` 15 项、`tellhow.test.ts` 4 项、`companyProvider.integration.test.ts` 3 项（PGlite + 真实 `AiInfraRepos`：启用即列出、关闭即消失、用户视图无明文 / 密文）。

- **P2-4 测试连接与目录同步（已实现，2026-11-24）**：新增 `packages/business-server/src/adminConsole/modelCatalog.ts`，提供 `testModelServiceConnection`（`GET {baseURL}/models`，返回 `{ ok, latencyMs, modelCount, errorCode? }` 并写入 `config.ai.lastTest`；未启用也可测试）与 `refreshModelCatalog({ apply, expectedUpdatedAt? })`（新增 `source: 'sync'` / `pending: true` / `open: false`，上游消失只写 `removedAt` 不删除，已存在行的 `name` / `open` / `type` 不被覆盖，`apply: false` 只返回 diff，`apply: true` 仅在确有变化时经 `updateConfig` 写入并走乐观锁，重复 apply 幂等）。错误码沿用 `ADMIN_CONSOLE_ERROR`：`PROVIDER_NOT_CONFIGURED` / `PROVIDER_AUTH_FAILED` / `PROVIDER_HTTP_ERROR` / `PROVIDER_INVALID_RESPONSE` / `PROVIDER_UNREACHABLE` / `PROVIDER_TIMEOUT`（超时默认 10 s，可覆盖）。出站统一 `companyProviderFetch()`（`ssrfSafeFetch` + 本条地址放行，响应体上限 1 MiB）。`packages/business-server/src/companyProvider.ts` 追加 `readCompanyProviderCredentials()`（管理员操作可忽略 `enabled`）与 `companyProviderFetch` 的额外 SSRF 选项参数。

- 接口（P2-4）：`testModelServiceConnection`（mutation）/ `refreshModelCatalog`（mutation，`{ apply, expectedUpdatedAt? }`）追加在 fork 自有 `apps/server/src/routers/lambda/adminConsole/modelService.ts`，均走 `adminProcedure`；**未改任何 §8.2 共享文件**。

- 单测（P2-4）：`apps/server/src/routers/lambda/adminConsole/modelCatalog.test.ts` 51 项（类型推断、新增 / 消失 / 未变化 / 恢复 / 幂等 diff、管理员编辑不被覆盖、错误码映射、超时、apply 幂等）；`modelCatalog.router.test.ts` 9 项（PGlite + tRPC：两接口 admin 可用、非管理员 `ADMIN_REQUIRED`、`lastTest` 落库、dry-run 不写、apply 后新增关闭待确认、二次 apply 不写、非法存量类型拒绝）。

- **P2-5 `/admin` 模型服务页（已实现，2026-11-24）**：新增 `src/features/AdminConsole/ModelService/*`（Service connection / Model catalog / Defaults 三张卡片）与 `src/routes/(main)/admin/model-service`，挂在既有 `adminConsoleRoute` 下（未改共享路由文件）。页面覆盖保存、测试连接、目录搜索 / 类型筛选 / 开放开关、手工增删改与同步 diff 预览；错误码统一走 `handleError`，乐观锁冲突弹「刷新」确认框。

- **P2-6 用户侧联调与真实验收（2026-11-24）**：在本地真实运行环境（真实 Next + Vite SPA + Postgres/Redis + 本地 OpenAI 兼容网关 + 本地 QStash）完成 §11 P2 八条验收：
  - 新注册普通用户在「设置 → 服务商」看到 **Tellhow AI** 位于 **Enabled** 分组，页面上没有任何密码输入框；管理员开放的 `tellhow-chat-pro` / `tellhow-chat-lite` 出现在聊天模型列表，未开放的 embedding /vision 不出现。
  - 用 `tellhow-chat-pro` 完成一次真实对话：上游收到带 `Authorization: Bearer` 的 `/v1/chat/completions`，回复落库并在界面渲染。
  - 管理员关闭某个模型后用户模型列表即少一项（恢复后回来）；`enabled: false` 后 Tellhow 从用户侧消失，已有会话的下一次请求返回可读错误而不是 500。
  - 目录同步：新增 4 个模型全部 `pending`（Needs review）且 `open: false`；上游移除的 `tellhow-vision` 只写 `removedAt`，目录行仍保留，重新出现后 `removedAt` 被清除。
  - 管理端「Test connection」返回 `Connected · 148ms · 4 models`；改成错误密钥后返回 `PROVIDER_AUTH_FAILED`；改回后 `ok: true / 570ms / 3 models`，证明地址与密钥改动对下一次请求生效。
  - 设置页、对话与 `adminConsole.getModelServiceConfig` 的响应都不含明文或密文密钥（`config.ai.apiKey` 只剩 `last4` / `updatedAt`，请求体里只有掩码占位）；`user_settings` 的 `key_vaults` / `general` / `language_model` 三列 md5 在保存配置前后完全一致。
  - **联调发现并修复**：`/admin` 与 `/admin/model-service` 深链在 Web 根路径返回 307 回首页（`src/proxy.ts` matcher 未包含 `/admin`），菜单内跳转之外无法直达 / 刷新。已补 `/admin`、`/admin/(.*)` 并加 `src/proxy.test.ts` 回归用例。
  - **交付方式**：PR #8 已 merged 到 canary（base `canary`，2026-11-24T05:59:35Z）；P2-6 修复另以合并提交 `6dfaa3ec85` 直接推送 `origin/canary`（本机没有 `gh` 与可用的 GitHub token，无法新开 PR 或编辑 PR #8 描述）。合并后仍需人工给 PR #8 补验收链接与共享文件清单。

- 验收报告：<http://192.168.14.51:3210/acceptance/98d0b60e-0026-4e7f-ab48-23d4091cd271>。

### P2（状态）

§11 P2 八条已在真实环境逐条验收，证据见 `ADMIN_CONSOLE_DESIGN.md` §15.7 与验收报告；剩余仅为有 GitHub 凭证时补开 PR。范围与失败态见设计文档 §3–§7、§13.3；§14 的四项产品假设结论已回写。

## CUST-009：管理员统一实验室（Labs）开关

设计与三道闸门见 [ADMIN\_CONSOLE\_DESIGN.md §16](ADMIN_CONSOLE_DESIGN.md#16-cust-009管理员统一-labs-开关)。核心约束：**实验室开关必须挂在 `users.preference.lab` 链上，不能另建 feature flags 清单**，否则上游新增 lab 时本 Fork 需要维护第二份列表，自动跟随就断了。

### 功能与入口

- **管理员** `/admin/labs`（控制台侧栏「实验室」）：控制方式（每位用户 / 管理员统一控制）、实验矩阵、内部开关、只读 / 不可用标注、显式保存与 `expectedUpdatedAt` 乐观锁。矩阵行来自上游 `ALL_LAB_FEATURES`，文案走既有 `labs` i18n 命名空间 → 上游新增 / 删除 / 改名 lab 与文案阶段全部自动跟随。
- **普通用户**：`admin` 模式下设置侧栏没有「实验室」、设置搜索搜不到实验室项、直连 `/settings/labs` 回落到外观页；`user` 模式（默认，且未配置时也是它）与上游行为完全一致，个人 Labs 页可见可切。
- **管理员自己**：仍可打开个人 Labs 页（`isAdmin`），但其 `preference.lab` 同样被部署开关覆盖 —— 读时覆盖对所有人生效，差别只在页面是否可见。
- **语义**：admin 模式下未显式开启的 lab = 关，**不回落个人偏好**；保留 `mode: 'user'` 作为回滚阀。

### 配置与数据来源

- 零迁移、零新表：`admin_console_settings.config.labs = { mode: 'user' | 'admin', flags: { [flag]: boolean } }`（复用 CUST-008 的单例行）。`flags` 稀疏，只存被显式打开的项。
- 解析：`effectiveLab = mode === 'user' ? user.preference.lab : { ...DEFAULT_PREFERENCE.lab, ...flags }`，唯一实现在 `packages/business-server/src/labs/resolver.ts`；存储层 `packages/business-server/src/adminConsole/labs.ts` 委托它，避免客户端负载与服务端 gate 语义漂移。
- 注册表 = 上游 `UserLabSchema`（完整列表）。不拿 `DEFAULT_PREFERENCE.lab` 当白名单 —— 它只含少量非 `false` 默认项，会把 `enableSelfLearning` 等真实 lab 丢掉。上游删除的键成为孤儿键，读取时静默丢弃；写入校验拒绝未知键。
- 5 秒进程内缓存（`resolveLabOverrides`），写入后 `invalidateLabOverrides` 立即失效；未配置、读失败、结构损坏一律回落到 `user` 模式，绝不因为读失败覆盖所有用户的偏好。

### 权限与运行边界

- 写入只经 `adminConsole.updateLabsConfig`（`adminProcedure`，角色与「最后管理员」语义沿用 CUST-008），带乐观锁；非管理员调用返回 `ADMIN_REQUIRED`。
- 读时覆盖点：① `user.getUserState` 返回前替换 `preference.lab`，并附带 `isAdmin` / `labsMode`；② 服务端 gate：agentSignal `featureGate`（自进化总闸）、`runSettings`（专家经验注入）、`codexDeviceRuntime` / `codexCollaboration`（hetero 能力）、`nightlyReview`（复盘用户筛选原始 SQL 在 admin 模式退化为 JS / 参数三态）；③ 客户端可见性：设置侧栏、工作区设置侧栏、设置搜索、Labs 路由、工作区 Labs 路由。
- **不写任何用户的 `preference.lab`**（不做全表 UPDATE），不改 `settingsRouter.updatePreference` 与 `featureFlags`。
- `enablePageCollab` 只读展示：另有部署级 `ENABLE_PAGE_COLLAB` 网关，单独开关不生效；`businessOnly` 项在自托管部署置灰；`enableTaskVerify` 这类「有 selector、无 Labs 页入口」的项单列在「内部开关」区。

### 共享文件接点（上游文件，逐文件行数）

| 文件                                                                             | 改动      | 说明                                                              |
| -------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| `apps/server/src/routers/lambda/user/profile.ts`                                 | +10/−1    | `getUserState` 覆盖 `preference.lab`，追加 `isAdmin` / `labsMode` |
| `apps/server/src/services/agentSignal/featureGate.ts`                            | +9/−15    | 自进化 gate 改走 resolver，删掉本地判定                           |
| `apps/server/src/services/agentSignal/services/selfIteration/review/schedule.ts` | +10/−3    | 复盘调度 gate 走 resolver                                         |
| `apps/server/src/services/aiAgent/pipeline/runSettings.ts`                       | +3/−1     | 专家经验注入 gate                                                 |
| `apps/server/src/services/aiAgent/pipeline/codexDeviceRuntime.ts`                | +3/−1     | hetero 能力 gate                                                  |
| `apps/server/src/services/aiAgent/pipeline/heteroDispatch/codexCollaboration.ts` | +3/−1     | 同上                                                              |
| `apps/server/src/services/aiAgent/runFacts.ts`                                   | +3/−0     | 给 gate 暴露 db                                                   |
| `packages/database/src/models/agentSignal/nightlyReview.ts`                      | +12/−1    | 原始 SQL 谓词在 admin 模式接收三态参数                            |
| `packages/types/src/user/preference.ts`                                          | +12/−0    | `UserInitializationState` 增加 `isAdmin` / `labsMode`             |
| `src/features/Settings/labs/features.ts`                                         | +8/−1     | `ALL_LAB_FEATURES` 改为具名导出（矩阵唯一数据源）                 |
| `src/features/Settings/features/SettingsContent.tsx`                             | +9/−0     | 直连 `/settings/labs` 回落外观页                                  |
| `src/features/Settings/hooks/useCategory.tsx`                                    | +5/−1     | 个人设置侧栏入口隐藏                                              |
| `src/features/WorkspaceSetting/hooks/useCategory.tsx`                            | +5/−1     | 工作区设置侧栏入口隐藏                                            |
| `src/features/SettingsSearch/items.ts`                                           | +6/−4     | 搜索结果按可见性过滤                                              |
| `src/features/SettingsSearch/useSettingsSearch.ts`                               | +6/−0     | 传入 `labsVisibility` 上下文                                      |
| `src/routes/(main)/[workspaceSlug]/settings/labs/index.tsx`                      | +24/−1    | 工作区 Labs 路由拦截                                              |
| `packages/locales/src/default/setting.ts`                                        | +60/−0    | 控制台文案（注册类追加）                                          |
| `locales/{en-US,zh-CN}/setting.json`                                             | 各 +46/−0 | 同上                                                              |

Fork 自有新增：`packages/business-server/src/labs/{resolver,index}.ts`、`packages/business-server/src/adminConsole/labs.ts`、`apps/server/src/routers/lambda/adminConsole/labs.ts`、`src/features/AdminConsole/Labs/{index.tsx,matrix.ts,draft.ts,style.ts,visibility.ts,visibilityModel.ts}`、`src/features/AdminConsole/hooks/useAdminLabs.ts`、`src/routes/(main)/admin/labs/index.tsx`、`packages/business-server/vitest.config.mts`（含 9 个测试文件）。CUST-008 自有的 `packages/database/src/models/adminConsole.ts`（+59）、`packages/types/src/adminConsole.ts`（+38）、`src/services/adminConsole.ts`（+12）、`src/features/AdminConsole/{route.tsx,Layout/Body.tsx}`（+6 / +6−1）、`apps/server/src/routers/lambda/adminConsole/index.ts`（+2）属于在同一 fork 文件内追加，不计入上游共享接点。

### 回归命令

本机没有 `bun`，`bun run check` 按其组成分别执行：

```bash
pnpm exec oxlint <changed-files>                                    # lint
cd packages/business-server && ../../node_modules/.bin/vitest run   # resolver / 读取点 / 孤儿键 / userState
node_modules/.bin/vitest run src/features/Settings/labs src/features/AdminConsole/Labs src/features/SettingsSearch/items.test.ts
node_modules/.bin/vitest run apps/server/src/routers/lambda/user/profile.labs.test.ts \
  apps/server/src/services/agentSignal/__tests__/featureGate.test.ts \
  apps/server/src/services/agentSignal/services/selfIteration/review/__test__/schedule.test.ts \
  packages/database/src/models/agentSignal/__tests__/nightlyReview.test.ts
node_modules/.bin/tsrs --noEmit -p tsconfig.type-check.json         # 全仓类型检查
```

### 真实验收（2026-11-25）

环境：本分支工作树的全栈 dev server（Next `http://localhost:29514` + Vite `http://localhost:23473`），测试库 Postgres 5434 / Redis 6380；身份为普通用户 `member@lobehub.com` 与管理员 `agent-testing@lobehub.com`。六项结论：

1. **默认态**：删除 `config.labs` 后，member 设置侧栏有「实验室」，`/settings/labs` 正常渲染 10 个开关，切换「项目工作空间」后刷新仍为开 —— 与上游一致。
2. **admin 模式**：管理员在 `/admin/labs` 切到「管理员统一控制」，只开「项目工作空间」「自进化」并保存后，member 侧栏无「实验室」、搜索「实验室」显示「未找到与 "实验室" 相关的设置」、直连 `/settings/labs` 落到 `/settings/appearance`。
3. **开启项可用**：member 主页侧栏出现 `/projects` 入口（`enableProjects` 走客户端 selector）；member 个人偏好此时全为关，服务端 `user.getUserState` 仍返回 `enableProjects: true`、`enableSelfLearning: true`，证明读取覆盖 + 服务端 gate 数据源放行。
4. **未开启项关闭**：member 个人偏好 `enableOAuthApps: true`，admin 模式下未开启该项 → 侧栏「OAuth 应用」消失、`getUserState` 返回 `enableOAuthApps: false`（不回落个人偏好）。
5. **5 秒内生效**：保存到 member 服务端负载改变实测 **515 ms**，未重启服务、未重新登录。
6. **回滚**：切回「每位用户」并保存后，member 的 `/settings/labs` 与个人偏好立即恢复；**上游跟随**：临时给 `ALL_LAB_FEATURES` 加假项后 `/admin/labs` 自动多一行、`catalog.test.ts` 按预期失败（拒绝无 selector 的条目），还原后恢复。

验收报告：<http://192.168.14.51:3210/acceptance/424bc1bf-5389-459b-a49c-7a22f1936aa7>。

### 上游合并时必须保留

1. `src/features/Settings/labs/features.ts` 的 `ALL_LAB_FEATURES` 必须保持 `export` 且不被上游改回非导出；矩阵行从它派生，不要改成维护第二份列表。
2. `UserLabSchema` 仍是 lab 注册表 —— 上游新增 / 删除 lab 时，先看 `src/features/Settings/labs/catalog.test.ts` 与 `packages/business-server/src/labs/{readPoints,orphanFlags}.test.ts` 是否报警，再决定补 catalog 还是加白名单。
3. `user.getUserState` 的 `preference.lab` 覆盖与 `isAdmin` / `labsMode` 字段不能被上游的 state 重构吞掉；上表 4 处服务端 gate 必须仍经 `resolveEffectiveLabForPreference` / `resolveLabGate`。
4. `config.labs` 是 **fork 自有字段**：上游若调整 `admin_console_settings.config` 或新增其他 `config.*` 消费者，用 `updateSettingsConfig({ labs })` 的局部合并写入，不要整行覆盖；本 Fork 不加迁移、不加表。
5. `/admin/labs` 路由、控制台侧栏入口、`adminConsole.labs` 过程与乐观锁语义保留。
6. 客户端可见性 5 处接点（两个 `useCategory`、`SettingsSearch` 两处、Labs 路由）保留；上游重构设置页结构时按新的 tab 注册点重新接一次，而不是整体回退文件。

### 当前发布状态

验收已通过并发布（<http://192.168.14.51:3210/acceptance/424bc1bf-5389-459b-a49c-7a22f1936aa7>），代码已合入 `canary`（2026-11-25，`2bcbbb2bfc`，父提交 `3ffc920630` + `0e603986ab`）；本机无 `gh` CLI 与 GitHub token，未开 PR，合入以直接推送的 merge 提交完成。`feat/admin-labs` 仍未删除，保留到下一次上游同步确认无回归后清理。

## CUST-010：管理控制台设备总览（只读，跨用户）

设计与偏差见 [ADMIN\_CONSOLE\_DESIGN.md §17](ADMIN_CONSOLE_DESIGN.md#17-cust-010管理控制台设备总览)。核心语义：这是**机器台账**（谁有一台什么设备、在不在线），不是个人设置设备页的复制品——**不做 owner 过滤**，管理员能看到全库所有行（含他人个人设备、所有工作区设备含 `private`）；但**看不到设备在哪个目录干活**。

### 功能与入口

- **管理员** `/admin/devices`（控制台侧栏「设备」，`MonitorSmartphone` 图标，正式导航项非隐藏暗门）：跨用户设备列表 + 顶部计数（总 / 个人 / 工作区 / 按平台 / 近 7 天活跃 / 工作区数）+ 筛选（范围 personal/workspace、平台、可见性 private/public、在线三态）+ 搜索（`q`，匹配 hostname/用户名）+ 分页；行点击开详情抽屉（连接通道与连接时间、平台、版本、托管阶段、工作区、所有者、最近出现）。
- **只读**：无删除、无改可见性、无改别名。跨用户写会绕过上游 `self-or-owner` 门，且 `devices` 是 upsert 语义（删掉下次连接自动回来）。
- **普通用户**：无侧栏入口；三个 procedure 全部走 `adminProcedure`，非管理员返回 `FORBIDDEN ADMIN_REQUIRED`，无会话 401。

### 共享文件接点（上游文件，逐文件行数）

| 文件                                                           | +        | −        | 说明                                                                                                                |
| -------------------------------------------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/services/deviceGateway/index.ts`              | +84      | −32      | **授权偏差**：抽出 `toDeviceAttachments()`（纯重构，行为不变）+ 新增 `readDeviceList()`，见下方「为什么必须改这里」 |
| `apps/server/src/services/deviceGateway/index.devices.test.ts` | +72      | 0        | 上述新方法的测试（上游同文件追加，不改既有用例）                                                                    |
| `packages/locales/src/default/index.ts`                        | +2       | 0        | 注册新命名空间 `adminConsole`（`import adminConsole from './adminConsole'` + `resources` 首项）                     |
| `packages/locales/src/default/setting.ts`                      | 0        | −273     | 230 条 `adminConsole.*` 键迁往 `adminConsole.ts`（含 42 条值续行 + 1 条注释）                                       |
| `locales/en-US/setting.json`                                   | 0        | −230     | 同上，迁往 `locales/en-US/adminConsole.json`                                                                        |
| `locales/zh-CN/setting.json`                                   | 0        | −230     | 同上，迁往 `locales/zh-CN/adminConsole.json`                                                                        |
| **合计（6 个）**                                               | **+158** | **−765** | 四个 locale 文件自 `merge-base`(`5489db1143`) 起上游提交数为 **0**；两个 `deviceGateway` 文件同样为 **0**           |

**为什么必须改 `deviceGateway`（任务书原本列为禁改，已获授权）**：上游 `readDevices` 在传输失败时回落 `queryDeviceList` 的 `[]`，管理端会把「网关没答」渲染成「这个人的设备全都没上线」——用户明确不接受这个谎言。`readDeviceList` 是**唯一**能区分「网关不可达」与「没有在线设备」的接法；`queryDeviceList` 保持原样（其既有调用方都把在线集当提示、本就接受 `[]`），因此是**单向新增 + 一次纯重构**，不改变任何既有调用方行为。约束：`deviceGateway` 的其余文件（`routers/lambda/device/**`、`packages/device-gateway-client/**`、`packages/database/src/{models,schemas}/device.ts`、`src/features/DeviceManager/**`、`src/store/device/**`）仍**零改动**。

Fork 自有新增（21 个文件，不产生合并冲突面）：`packages/types/src/adminConsole.device.test.ts`、`packages/locales/src/default/adminConsole.ts`、`locales/{en-US,zh-CN}/adminConsole.json`、`packages/database/src/models/__tests__/adminConsole.devices.test.ts`、`apps/server/src/routers/lambda/adminConsole/{devices.ts,devices.test.ts}`、`src/features/AdminConsole/Devices/{index,DeviceRow,DeviceDetailDrawer,PresenceBadge,platform,style}.tsx`+`{detail,utils,useDeviceFilters}.ts`+3 个测试、`src/features/AdminConsole/hooks/useAdminDevices.ts`、`src/routes/(main)/admin/devices/index.tsx`。Fork 自有修改（18 个，其中 16 个是 i18n 命名空间迁移的净零/负行改动）：`packages/types/src/adminConsole.ts`(+170)、`packages/database/src/models/adminConsole.ts`(+317/−3)、`src/services/adminConsole.ts`(+23)、`apps/server/src/routers/lambda/adminConsole/index.ts`(+2)、`src/features/AdminConsole/{route.tsx,Layout/Body.tsx,Layout/Header.tsx,Labs/index.tsx}`、`ModelService/*`(7)、`UserManagement/*`(3)。

### 配置与数据来源

- **零数据库迁移、零新表、零新索引**。读的是既有 `devices` 表，经 CUST-008 自有的 `AdminConsoleModel`（`packages/database/src/models/adminConsole.ts`）新增 `listDevices` / `getDevice` / `getDeviceStats`。
- **行身份 = 表真实唯一键**：personal 池是 `(user_id, device_id)`（`devices_user_id_device_id_unique`），workspace 池是 `(workspace_id, device_id)`。不能用 `(workspaceId, deviceId)` 一把梭——`lh connect --device-id` 可让两个 owner 用同一个 deviceId（`apps/cli/src/device/register.ts` 的 `resolveDeviceIdentity()` 在显式 id 时绕过哈希）。实现：`deviceRowKey` = `workspace ? wsId::deviceId : personal:${ownerId}::${deviceId}`；详情查询带 `ownerId`，`limit(2)` 后 `rows.length !== 1` 即 `NOT_FOUND`（歧义不猜）。
- i18n 用独立命名空间 `adminConsole`（新增 `packages/locales/src/default/adminConsole.ts` + 两个语言包 JSON）。`NS` 类型由 `typeof resources` 推导，`resources.ts` / `create.ts` / `loadI18nNamespaceModule*.ts` / `protectedPatterns.ts` / `i18next.d.ts` **均无需改**。
- **不跑 `bun run i18n`**：fork 不自动产生其余 15 语翻译，缺失语种回落 en-US，属可接受降级。
- 在线探测参数：`DEVICE_PROBE_CONCURRENCY = 5`、`DEVICE_PROBE_TIMEOUT_MS = 3000`、`DEVICE_READ_ATTEMPTS = 2`、`DEVICE_READ_RETRY_DELAY_MS = 250`，网关地址与 token 沿用上游 `DEVICE_GATEWAY_URL` / `DEVICE_GATEWAY_SERVICE_TOKEN`。

### 权限与运行边界

- 三个 procedure 均为 `adminProcedure`：`adminConsole.listDevices` / `getDevice` / `getDeviceStats`。角色语义与「最后一个管理员」保护沿用 CUST-008。
- **在线三态 `online | offline | unknown`**，`unknown` 与 `offline` 在任何一层都不得合并：

  | 触发                                                            | 结果                                               |
  | --------------------------------------------------------------- | -------------------------------------------------- |
  | 网关未配置（`isConfigured === false`）                          | 全部 `unknown`，**零请求**                         |
  | 探测成功且命中 deviceId                                         | `online`，`channelCount` = 实际通道数              |
  | 探测成功但池里没有该 deviceId                                   | `offline`                                          |
  | `readDeviceList` 返回 `ok: false`（连不上 / 重试 2 次后仍失败） | `unknown`                                          |
  | 探测抛错                                                        | `unknown`                                          |
  | 超过 3s 整轮预算                                                | 未回者 `unknown`，晚到结果丢弃（`accepting` 标志） |

- **`online` 筛选在 SQL 之后做**（在线是活状态，SQL 无法表达）：因此命中页可能短于 `pageSize`、`total` 仍是 SQL 全量，UI 用 `isDevicePagePartial` 提示，不伪造补页。
- 只读语义：`devices.last_seen_at` 无索引，跨用户全表列表 MVP 接受（当前部署 8 行）；数据量上来再谈索引，不改基线。

### 隐私白名单（三层纵深）

| 层   | 实现                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL  | `adminDeviceSelection` 显式列投影，**不选** `defaultCwd` / `workingDirs` / `recentCwds` / `metadata` 整列；`metadata` 只取 `sql\`${devices.metadata} ->> 'appVersion'\``与`'cliVersion'` |
| 类型 | `AdminDeviceSummary` / `AdminDeviceDetail` 无上述字段；唯一 metadata 出口是 `ADMIN_DEVICE_DETAIL_METADATA_KEYS = ['appVersion','cliVersion']`，契约测试用 `expectTypeOf` 编译期锁死      |
| 渲染 | `projectDeviceDetail(device): DeviceDetailView` 白名单投影，抽屉只渲染该视图——即使响应体多带字段也进不了 DOM                                                                             |

三层任一层单独失效仍有兜底，第三层防的是「取出来之后某次重构顺手渲染」。`defaultCwd` 的假命中（`devices.edit.defaultCwd` 是上游既有**重命名文案 key**）已排除。

### 回归命令

本机没有 `bun`，`bun run check` 按其组成分别执行：

```bash
node_modules/.bin/oxlint $( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | grep -E '\.(ts|tsx)$' )
node_modules/.bin/vitest run \
  src/features/AdminConsole/Devices/{utils,detail,useDeviceFilters}.test.ts \
  apps/server/src/services/deviceGateway/index.devices.test.ts \
  apps/server/src/routers/lambda/adminConsole/devices.test.ts              # 91 项
(cd packages/database && ../../node_modules/.bin/vitest run src/models/__tests__/adminConsole.devices.test.ts)   # 13 项
(cd packages/types   && ../../node_modules/.bin/vitest run src/adminConsole.device.test.ts)                     # 5 项
npx tsrs --noEmit -p tsconfig.type-check.json --checkers 4                 # 全仓类型检查
```

### 真实验收（2026-11-26，接口级）

环境：本分支工作树全栈 dev（Next `:29514` + Vite `:23473`），库 Postgres 5434 / Redis 6380，网关 `:8788`；身份 `qa.bob@lobehub.com`（admin）与 `member@lobehub.com`（普通用户）。

- **接口**：`/trpc/lambda/adminConsole.*` 真实路径（`/api/trpc/*` 不存在，被 Next 兜底 307，勿误判）。`whoami` 对 admin 返 `{isAdmin:true}`、对 member 返 `{isAdmin:false}`；`listDevices` 返回 8 台设备（跨用户 + 3 台 workspace 可见）；member 调用三个 procedure 全部 `403 FORBIDDEN ADMIN_REQUIRED`（-32003），无 cookie `401`。
- **筛选与分页**：`q=tellhowsoft` → 2；`scope=workspace` → 3；`platform=linux` → 4；`visibility=private` → 1 / `public` → 2；`pageSize=3` 第 1 页 3 条、第 3 页 2 条且 `total=8`。
- **三态**：`lh connect` 拉起 `dev_s7_probe` 后该行 `online`、其余 `offline`，`online=online` 筛选命中 1 条；`getDeviceStats` → `{total:8, personal:5, workspace:3, byPlatform:{linux:4,darwin:3,win32:1}, activeLast7d:8, workspaceCount:1}`。`unknown` 分支由单测（未配置 / reject / 预算耗尽 / `ok:false`）锁死，未在真机停网关复现。
- **性能**：`listDevices` 3 次 67–89 ms（含 5 路并发探测）。
- **质量门**：改动范围 `oxlint` 0 warning / 0 error（41 文件）；相关测试 109 项全过；全仓 `tsrs` 退出码 0。

### 上游合并时必须保留

1. `apps/server/src/routers/lambda/adminConsole/index.ts` 的 `...adminDeviceProcedures` spread（三个 procedure 的注册点）。
2. `src/features/AdminConsole/route.tsx` 的 `devices` 子路由 + `src/routes/(main)/admin/devices/index.tsx` 这个一行 re-export。`desktopRouter.shared.tsx` **不需要**改（`/admin` 容器路由已注册）。
3. `src/features/AdminConsole/Layout/Body.tsx` 的 `DEVICES_PATH` / `devicesActive` / `NavItem`（`MonitorSmartphone`）+ `adminConsole` 命名空间的 `nav.devices` 键。
4. `packages/locales/src/default/index.ts` 的 `resources.adminConsole` —— 不注册则打包版（Electron / 无网络 SSR 首屏）拿不到该命名空间，会「浏览器能用、桌面首屏闪 key」。
5. **`deviceGateway.readDeviceList` 与 `toDeviceAttachments` 不能被上游的 `readDevices` 重构吞掉**：`readDeviceList` 返回 `{ ok: true, devices } | { ok: false, reason }`，`queryDeviceList` 仍是 `[]` 回落。上游若把 `readDevices` 改成抛错或返回哨兵值，先确认管理端仍能拿到 `ok:false`，再把本 Fork 的多余接法删掉（而不是两边并存）。
6. 探测三参数（并发 5 / 超时 3000ms / `unknown` 降级）不可调成「失败即 offline」；`resolveOnlineStates` / `tallyOnline` / `probePrincipals` 是纯函数，可被上游重构移动但语义必须保留。
7. 隐私三层中的 `adminDeviceSelection` 投影与 `ADMIN_DEVICE_DETAIL_METADATA_KEYS` 是**唯一** metadata 出口；上游给 `devices.metadata` 加字段时不要顺手放开投影。
8. 行身份必须仍是 `(user_id, device_id)` / `(workspace_id, device_id)`；上游给 `devices` 加唯一键或改 upsert 语义时重跑 `adminConsole.devices.test.ts` 的「双池互斥」与「他人 private 可见」两条语义锁。
9. 已知限制（不修）：`DEVICE_GATEWAY_URL` 配了但 `DEVICE_GATEWAY_SERVICE_TOKEN` 缺失时，网关客户端 `getClient()` 返回 `null`，`readDeviceList` 会报 `GATEWAY_NOT_CONFIGURED` → 全部 `unknown`（**不会再误报 offline**）；但上游 `queryDeviceList` 在同样场景仍回落 `[]`，个人设置设备页行为不变。运维文档要求两者成对配置。

### 当前发布状态

代码已完成并通过本地质量门与接口级验证，已随 `feat/admin-labs` 合入 `canary`（2026-11-26，合并提交 `fb30266fd8`）。**未发布 acceptance 报告**：三态中的 `unknown` 只有单测覆盖，未在真机停网关复现；UI 侧列表 / 详情抽屉 / 普通用户被拒三张截图未归档。因此本条目状态是「代码已合入、产品验收待补」，不是「已验收」——补证后需回填本节与总表行。

## CUST-011：管理员默认值 = 全站默认值

一句话：管理员在 `/admin` 模型服务里设的 `defaults`（chat / title / verify / embedding）是**全站默认模型**——存量用户、新注册、SSO 首次登录，以及标题生成 / 记忆向量 / 任务验收等后台任务，只要用户没自选，都按它解析；用户自选过则保留自选。

完整语义（映射表、自选判定、逐槽位兜底顺序、不可用模型回退、备选口径）见 [ADMIN\_CONSOLE\_DESIGN.md §7.1](ADMIN_CONSOLE_DESIGN.md#71-默认值解析cust-011)；产品面描述见同文档 §5.5。

### 功能与语义

- **映射**：`chat` → 主档全部槽位（`SERVICE_MODEL_TIER_SLOTS.main`：`agentMeta` / `expertise` / `goal` / `topicAutoSummary`）+ `defaultAgent.config`（新会话默认模型）；`title` → flash 档全部槽位；`verify` → `verify` 槽位（必须视觉模型）；`embedding` → `userMemoryEmbedding`。`fileEmbedding` 仍归 `DEFAULT_FILES_CONFIG`，`asr` / `channelRouting` / onboarding 槽位不归本项。
- **生效规则**：有自选保留自选（`user_settings.systemAgent[slot]` 的 model+provider、`systemAgent.tiers[tier]` 的档位选择、`defaultAgent.config` 的 model+provider）；没自选一律解析为管理员默认值。自选判定必须读存储行，不能读客户端合并后的 `currentSettings`。
- **逐槽位兜底顺序**：`用户自选 > 管理员默认值 > SYSTEM_AGENT / DEFAULT_AGENT_CONFIG 环境变量 > 代码默认`。环境变量仍生效，只是排在管理员默认值之后；管理员留空即回到环境变量。
- **不写用户行**：默认值只在解析时兜底；写进 `user_settings` 等于固化，管理员之后再改就不跟随。`initNewUserForBusiness` 在本仓库是空实现，新用户本来没有设置行。
- **后台任务**：标题生成 / 记忆抽取 / 任务验收等无标签页的调用走同一顺序（T-91 已接入）：
  - `resolveSystemAgentModelConfig`（`apps/server/src/services/systemAgent/modelConfig.ts`）现在是 `override > 用户自选 > 管理员默认 > SYSTEM_AGENT > 代码默认`，管理员层只在用户没选全时才读，且经 `getCompanyServiceDefaultModel` 走同一个 5 s 缓存；调用方也可传入已解析的 `adminDefaults` / `envDefaults`。
  - `resolveVerifyServiceModel`（`apps/server/src/services/verify/modelConfig.ts`）在用户 `verify` 与 `SYSTEM_AGENT` 之间插入管理员 `verify` 默认值。
  - 记忆抽取（`apps/server/src/services/memory/userMemory/extract/`）把 `serverConfig.systemAgent`（管理员已压在 env 之上）合并到用户设置之下，只覆盖 `userMemoryEmbedding` / `memoryAnalysisAgentConfig`；`resolveRuntimeAgentConfig` 对 `tellhow` 复用 `resolveCompanyProviderParams` 取服务端密钥，不依赖用户 keyVaults。
  - `botRetro` 等直接读 `DEFAULT_SYSTEM_AGENT_ITEM` 的固定模型不属于 Service Model 槽位，不接入管理员默认值。
- **不可用模型回退**：`enabled !== true` / 缺 `baseURL` / 缺密钥 → 整块默认值视为未配置；某项模型 `open === false` 或带 `removedAt` → 该项视为未配置；两种情况都回退下一级，不产生指向不可用模型的默认值。管理端校验仍只要求 id 在目录里（允许「先选默认值、后开放模型」），UI 需提示「默认值暂不生效」。
- **provider**：默认值的模型 id 属于 Tellhow 目录，provider 固定 `tellhow`；不提供「默认值指向其他厂商」的能力。
- **备选口径（本次不实施，待用户确认可切换）**：强制覆盖所有用户自选（含 pin 与档位选择）。启用时的建议形态是 `config.ai.defaults.mode: 'follow' | 'force'`（默认 `follow` 即本次口径），`force` 也只做解析覆盖、不改用户行，否则切回 `follow` 时用户原选择已丢失。

### 维护位置

| 层                 | 位置                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 语义（唯一事实源） | `ADMIN_CONSOLE_DESIGN.md` §7.1（映射与生效规则）、§5.5（产品面），槽位清单来自 `packages/const/src/settings/systemAgent.ts` 的 `SERVICE_MODEL_TIER_SLOTS`                                                                |
| 写入与校验         | `packages/business-server/src/adminConsole/modelService.ts`（`validateDefaults` / `toConfigView`，P2-2 已交付）                                                                                                          |
| 读取与缓存         | `packages/business-server/src/companyProvider.ts`（`CompanyProviderRuntime.defaults`，5 s 缓存 + `invalidateCompanyProviderCache()`）                                                                                    |
| 管理端 UI          | `src/features/AdminConsole/ModelService/DefaultsCard.tsx`、`locales/{en-US,zh-CN}/adminConsole.json` 的 `modelService.defaults.*`                                                                                        |
| 解析消费           | `packages/business-server/src/adminConsole/serviceDefaults.ts`（`resolveCompanyServiceDefaults` / `getCompanyServiceDefaultModel`）；`serverConfig` 注入在 `apps/server/src/globalConfig/index.ts`；后台任务读取点见上条 |
| 用户侧跟随链路     | `src/store/user/slices/common/action.ts` 的 `#project` → `defaultSettings`；`src/store/user/slices/settings/selectors/settings.ts` 的 `currentSettings`                                                                  |

### 与 CUST-008 §7 的关系

CUST-008（管理员控制台）负责「配置能不能写、密钥怎么存、目录怎么同步」；CUST-011 只负责「写下来的默认值有没有人读、按什么规则读」。两者共用同一行 `admin_console_settings.config.ai`：

- 不新增表、不新增迁移、不新增 procedure —— `updateModelServiceConfig` 的 `defaults` 入参与 `validateDefaults` 校验在 P2-2 已存在，CUST-011 补的是运行时消费与回退；
- CUST-008 的 §5.1–§5.4、§5.6、§11 验收清单不变，只有 §5.5「默认值」被重写、§7 增加 §7.1 解析小节；
- 任务书写作「§7（模型服务）」；本文档当前编号里模型服务是 §5（§5.5 默认值），§7 是「后端接口」——因此映射与解析规则落在 §7.1，§5.5 只保留产品面口径并指向 §7.1。

### 上游合并时必须保留 / 检查接点

1. `SERVICE_MODEL_TIER_SLOTS` 仍是槽位唯一事实源，`fileEmbedding` 不得进档位映射；上游新增 / 删除槽位时管理员默认值映射要自动跟随，不维护第二份清单。
2. 客户端 `#project` 仍把 `serverConfig.systemAgent` / `serverConfig.defaultAgent` 合并进 `defaultSettings`，`currentSettings = merge(defaultSettings, settings)` 不变——「未自选 = 跟随默认」靠这条链路成立。
3. 自选判定必须读 `user_settings` 存储行，不得读合并后的 `currentSettings`（否则跟随会被误判成自选，管理员默认值永远不生效）。
4. 写盘侧 diff 基准仍是 `defaultSettings`；「选回跟随」依赖 `replaceServiceModelSettings` 删除槽位键，上游若改成合并写，要补一条删键路径。
5. 后台任务读取点（`resolveSystemAgentModelConfig`、`resolveVerifyServiceModel`、记忆抽取 runtime）必须走统一解析函数，不能被上游改成各写一份默认值。
6. `companyProvider` 的 `defaults` 仍随 5 s 进程内缓存返回，并在保存配置后失效。
7. 管理端默认值文案 `modelService.defaults.*` 与语义同步（现有「只影响新用户的初始选择」需要改写），en-US 源文案写 `packages/locales/src/default/`，zh-CN 手写。

### 当前发布状态

文档先行（2026-11-26，分支 `feat/admin-model-defaults`）：语义已定稿并登记。代码实现与真实验收在 T-90 ~ T-94（注入 `serverConfig`、后台任务兜底、新用户默认只开 TellhowAI、个人页与文案对齐、存量 / 新注册 / SSO 验收），**尚未合入 canary、未发布验收报告**。

## 上游合并统一流程

1. 提交或备份本地改动，记录本次上游起止提交、当前镜像 SHA，备份数据库 / 卷和 `.env` /override。不要重建加密密钥。
2. 按总表逐项标记 “未受影响 / 已迁移 / 已被上游替代 / 待解决”。Git 没有报冲突也要检查入口、配置和运行时调用链是否仍连通。
3. 逐个接点合并；不要对共享文件整体选 ours /theirs。上游有等价实现时迁移定制能力并删掉旧接点，更新本清单，避免保留两套逻辑。
4. 跑改动范围的 `bun run check [路径...]`；部署脚本变更跑 `bash -n scripts/deploy-custom-image.sh` 和 `python3 scripts/deploy-custom-image.test.py`。有 Docker 时再跑 `python3 scripts/deploy-custom-image.test.py --compose-check`，此命令只解析配置。
5. 镜像按目标平台实际构建；在部署本分支的环境验证受影响入口。TFS 至少验个人身份隔离、项目 / 环境来源保存与一次实际代码初始化。单测、原型和生产 debug proxy 不能代替真实产品验收。
6. 将合并日期、上游提交、迁移位置、检查结果及剩余限制补到相关条目。源码、脚本和镜像必须属于同一已发布版本，再用服务器脚本更新。
7. 上游新增或删除 lab（`UserLabSchema` / Labs 页变化）时：确认 `src/features/Settings/labs/features.ts` 的 `ALL_LAB_FEATURES` 仍为具名导出并已包含新项，跑 CUST-009 的三道闸门测试（`catalog.test.ts`、`i18n.test.ts`、`labs/readPoints.test.ts`、`orphanFlags.test.ts`），再用管理员打开 `/admin/labs` 看新行是否自动出现。`admin_console_settings.config.labs` 是 Fork 自有配置：上游改动 `config` 结构或新增 `config.*` 消费者时，用 `updateSettingsConfig({ labs })` 局部合并，不要整行覆盖，也不要随上游删除该字段。

## 后续二开的登记格式

新增 `CUST-006` 起的条目，不复用已删除编号。每项至少写：功能 / 用户入口、涉及文件及共享接点、配置与密钥来源、数据库兼容性、权限与运行边界、回归命令 / 真实验收证据、上游合并保留点和当前发布状态。详细内容可分文件，但本总表必须有入口。

## 本轮检查记录

- 提交前已 rebase 到远端 `canary` / `124c7ebaed`，无冲突；补齐上游新增钉钉适配器的本机 workspace 依赖后，69 个提交文件的检查通过：208 项相关测试通过、全仓类型检查通过，lint 仅有既有 1 条导入风格 warning。依赖同步未修改受版本管理的清单。

- TFS 前轮：208 项测试通过，类型检查通过，lint 无错误、既有 1 条 warning；真实 NTLM REST 查询与本机 Git 克隆成功。细节见 TFS 文档。

- 本轮部署补充：15 项 Python 测试通过，覆盖首次安装密钥生成、老部署补缺省值、保留已有 / 禁用 / 托管的 TFS 设置、原密钥与 `.env` 不被更改，以及既有回滚和 Onlyboxes 协议测试。

- 本轮相关文件 `bun run check --lint --test` 通过，22 项部署相关 TypeScript 测试通过，lint 无错误；`bash -n` 和 `git diff --check` 通过。Python / Shell / Dockerfile 等没有对应 linter 的文件不计为已 lint。

- 本轮部署自动重跑（2026-11-17）：`python3 scripts/deploy-custom-image.test.py` 24 项通过（登记先于结算、只登记运行中会话、跳过 `waiting_for_human` 陈留、写入失败不阻塞结算、`RESUME_AFTER_DEPLOY=0` 不登记、dry-run 不登记、`RETURNING` 计数不被 psql 命令标签污染）；`pnpm exec vitest run apps/server/src/services/deployResume/index.test.ts` 19 项通过；`pnpm exec oxlint` 覆盖改动文件 0 warning / 0 error；`pnpm exec tsrs --noEmit -p tsconfig.type-check.json` 退出码 0；`bash -n scripts/deploy-custom-image.sh` 通过。本机没有 `bun`，`bun run check` 按其组成（lint + 相关测试 + 全仓类型检查）分别执行。迁移 `9000` 与 `queue_resumes()` 的真实 SQL 已在 `lobe-postgres` 的临时库 `deploy_resume_probe` 上跑通：建表建索引、3 行登记（2 任务 + 1 对话）、二次部署就地重新武装（总行数仍为 3）、`RESUME_AFTER_DEPLOY=0` 写 0 行、按 id 的 `claim` 只有一方成功、`listPending` 命中 `(status, created_at)` 索引。

- 同批修正一个既有类型错误：`apps/server/src/services/tfs/git.ts` 读取 `getUserSettings()` 返回的 `market` jsonb 时被推断为 `{}`，导致全仓 `type-check` 失败；按 `MarketAuthTokens` 收窄后再读 `accessToken`。与部署自动重跑无关，仅因阻塞类型检查门禁一并修复。

- 尚未执行：真实造一次中断（更新时正在跑的任务 / 对话）后由新容器启动自动重跑的端到端验收、Docker 镜像构建、目标服务器升级。线上容器镜像早于本次改动，单纯重启只会跑旧代码；真实验收要先构建并推送镜像再走一次更新。库表与脚本 SQL 已在真实 PostgreSQL 上验证，但这不等于产品级恢复验收。

- 尚未执行 Docker 镜像构建、真实 Compose 解析、目标服务器升级及真实页面验收；不能据此宣称已经上线或全链路通过。

- 上游同步（2026-11-18）：已 rebase 到 `upstream/canary` `55c24e8fb6`，保留 TFS、Fork CLI、部署结算与自动恢复定制；上游 `0220_channel_sections` 与本 Fork 的恢复队列迁移使用 `9000_nosy_tag` 保留区，两份 snapshot 和 journal 已连续校验。

- 上游同步（2026-11-19）：合并 `upstream/canary` `0410a4a148`，保留项目环境的一环境多仓库模型，并将 TFS 授权、项目来源校验、云端初始化和个人设备兼容入口迁移到新调用链。冲突集中在项目环境 / 沙盒初始化共享接点；Fork 的 `9000_nosy_tag` 迁移未受影响。

- 上游同步（2026-11-20）：合并 `upstream/canary` `1ce7bdcefb`（14 个提交，含一环境多仓库的环境重构、channel 线程与交付记录、异种 agent 权限模式、density Compact）。Git 冲突只有 `packages/database/migrations/meta/_journal.json`：上游 `0224_agent_deliveries_and_contact_request_source` 占用 idx 224，Fork 的 `9000_nosy_tag` 顺延为 idx 225，`9000_snapshot` 以 0224 快照为 `prevId` 重建，journal 连续无空洞。语义冲突（上游删掉接口、Fork 文件仍引用）三处，均按上游新接口在 Fork 侧适配、未回退上游：`apps/server/src/services/tfs/agentContext.ts` 的 `ProjectModel.listEnvironments` → `ProjectEnvironmentRepository.get`；`sandboxEnvironmentOptions.ts` 的 `repositorySelection` 统一为双参数签名并由 `SandboxDrivePicker` 同步调用；`src/features/Projects/AddEnvironmentModal.tsx` 的 `attachRepository` / `attachEnvironment` 与 `environment.add.*` 文案在上游移除后补回客户端 service、store 动作和 en-US /zh-CN 文案，接点改走服务端保留的兼容过程。结果：`tsrs --noEmit` 0 错误（合并中途为 15 处 / 3 文件）、改动文件 oxlint 0 错误、`agentContext` / `sandboxEnvironmentOptions` / `SandboxDrivePicker` 共 36 项测试通过。未执行：真实页面验收、Docker 构建、目标服务器升级。

- 上游同步（2026-11-20，第二次）：合并 `upstream/canary` `89b7d51732`（2 个提交：运行资源设置页合并 workspace /private 视图、删除 artboard 来源列）。冲突只有 `_journal.json`：上游 `0225_artboard_boards_drop_old_sources` 占 idx 225，Fork `9000_nosy_tag` 顺延为 idx 226，`9000_snapshot` 的 `prevId` 改为 0225 快照。已校验 journal idx 连续（0–226）与快照链；本机没有 `node_modules`，未执行 `tsrs` / 测试，需在 CI 或安装依赖后补跑。

- 迁移编号与快照修正（2026-11-20）：`9000_nosy_tag` 的 journal `idx` 由 226 改为 9000，固定在保留区，避免 fork 下次 `db:generate` 按 `last.idx + 1` 抢到上游的 `0227` 编号与文件名。同时发现 `9000_snapshot.json` 只是把 `prevId` 指向 0225，表结构仍停留在 0224 之前：`public.artboard_boards` 还带 `source_file_id` / `source_work_version_id` 及对应索引与 check，与已执行的 `0225_artboard_boards_drop_old_sources` 不符，下次 `db:generate` 会重复生成已执行过的 `DROP COLUMN` 并在新库上报错。现按「0225 快照 + `deploy_resume_queue`」重建（表数 251 不变，只有 `artboard_boards` 变化，`prevId` 仍为 0225 快照 `df89ac9e…`）。新增 `scripts/fork/reconcileMigrations.ts` 与 `bun run db:fork:reconcile` 固化「队尾排序 /when 单调 / 快照基准重建」三步；脚本已在本地实跑两轮，`--check` 通过。

- 上游同步（2026-11-20，第三次）：合并 `upstream/canary` `930fefdc53`（76 个提交，含 Marketplace 应用能力重构、Agent 头像、Channel 多项、OpenAPI 生成接口、调度任务表等）。冲突 9 处，处理如下：
  1. `packages/database/migrations/meta/_journal.json`：上游新增 `0226_agent_share_grants`。取上游 journal 后重新追加 `9000_nosy_tag`，再跑 `db:fork:reconcile`：idx 固定 9000、`when` 取上游最后一条 +1ms、`9000_snapshot.json` 以 0226 快照 + `deploy_resume_queue` 重建。
  2. `locales/{en-US,zh-CN}/integration.json`：保留 `tfs.*` 文案；上游随集成页下线删除的 `upcoming.*` 一并移除（代码已无引用）。
  3. `packages/database/src/models/taskTopic.ts`：双方各自新增类型与操作符，合并为同时导入 `TaskRecentRun`、`TaskRunTrigger` 与 `lte`。
  4. `src/features/Integrations/{index.tsx,Overview.tsx,registry.ts}`（modify/delete）：上游把集成目录迁到 Marketplace 并删除该页，Fork 只在其上注册过 TFS。接受删除，TFS 改为独立设置页，不再依赖集成目录。
  5. `src/features/EnvironmentManager/CreateEnvironmentModal.tsx`：上游改为多仓库 `RepositoryField`。采用上游结构，保留 TFS 来源：新增「添加 TFS 仓库」按钮，选中后把 `{ name, remoteUrl, defaultBranch }` 追加到同一 `repositories` 列表，沿用 `layoutRepositorySources`。
  6. `src/features/Projects/CreateFromGithub/Content.tsx`：以上游结构为骨架（单一 `repositories` 状态、`RepositoryField` + `AdvancedRepositories`、`useDefaultMainAgent`），只在 `provider === 'tfs'` 处把 TFS 选择器作为同一列表的入口，TFS 跳转改为 `/settings/tfs`。不要再用单仓库表单整体替换上游文件，否则每次上游改动都会重新冲突。
  7. 新增 `SettingsTabs.Tfs = 'tfs'`、`src/features/Tfs/SettingsPage.tsx`、`/settings/tfs`（复用设置 `:tab` 路由）、侧栏「TFS / Azure DevOps」入口与 `setting:tab.tfs` 文案；旧 `/settings/integrations/tfs` 由 `buildLegacyIntegrationPath` 跳到新页。
     验证：`db:fork:reconcile --check` 通过；改动文件 esbuild 语法检查通过、相关 JSON 可解析；本机无 `node_modules`，未跑 `bun run check` / 类型检查 / 测试。
- CUST-011 文档登记（2026-11-26，分支 `feat/admin-model-defaults`）：只改 `ADMIN_CONSOLE_DESIGN.md`（§5.5 重写、新增 §7.1、§10 检查点、§14 修订说明）与本文档（功能总表 + CUST-011 章节），未动代码。`git diff --check` 通过；无代码改动，未跑测试与类型检查。
