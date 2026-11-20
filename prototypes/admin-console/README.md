# 管理员控制台交互原型（第四版）

直接双击用浏览器打开 `index.html` 即可，无需构建、无需依赖。纯静态，数据是 mock，不连接真实接口。

设计与实现方案见仓库根目录 [`ADMIN_CONSOLE_DESIGN.md`](../../ADMIN_CONSOLE_DESIGN.md)。原型覆盖设计里的四个页面，导航顺序即交付顺序（用户 → 审计 → AI 服务 → 设备）：P1 只上线前两个，AI 与设备在 P2 / P3 才出现。没有外观、快捷键、数据统计页，也不再有「用户设置模板」页。

## 视觉基线

原型不另造后台风格，直接复刻现有「设置」页：

- 外壳按 `src/features/Settings/Layout`：左侧 NavPanel（280px，`colorBgLayout` 背景，loose 密度：44px 页头、36px 导航项 / 14px 文字 / 28px 图标盒）+ 右侧 44px 页头；
- 侧栏分组按 `Settings/Layout/Body`：搜索框（`SearchBar variant="filled"`，32px 高、`fill-tertiary`）+ 分组标题 + 组内 `gap: 1px` 的导航项；
- 内容区 `MAX_WIDTH = 1024`，`paddingBlock: 24px 128px`、`paddingInline: 24px`；
- 卡片复刻 `@lobehub/ui` 的 `Form variant="filled" itemsType="group"`：外层 12px 圆角 `fill-quaternary` 承载，内层 `colorBgContainer` 卡片（`margin: 0 3px 3px`、8px 圆角、1px `colorBorderSecondary` 边框；浅色叠 4 层阴影，深色无阴影 —— 对应 `groupStyles.bodyFilledLight` 只在浅色挂载）；
- 颜色、圆角、阴影全部走 `--lobe-color-*` / `--lobe-radius*` / `--lobe-shadow-*` token，取值对齐 `@lobehub/ui` 的 `theme.css`（主色 `#222222`，深色下反转为 `#eeeeee`），右上角按钮切换深浅色。

## 四个页面

### 用户管理

- 搜索（工号 / 姓名 / 邮箱）、筛选（全部 / 管理员 / 已禁用）、按工号排序；
- 行内看角色、状态、分配到的设备数、最后活跃；
- 点击行打开 520px 详情抽屉：「概览 / 设备授权 / 操作」三个 tab；
- 操作 tab 里禁用/启用、设/撤管理员、会话失效，每个动作落一条审计（在「审计日志」页立即可见）；
- 底部备注说明账号来自 SSO，这里不新建账号体系。

### AI 服务

- 菜单可见性：两个开关，分别对应非管理员隐藏「AI 服务商」「服务模型」；
- 服务商：Provider 卡片，启停 + 模型多选（每个 Provider 至少保留一个模型）；停用的 Provider 不会出现在用户会话的模型选择器里；
- 默认模型：provider / model 两级选择，写入 `default_agent.config` 与 `language_model`；
- 服务模型：四个层级（main / flash / embedding / verify，按 `SERVICE_MODEL_TIER_SLOTS` 展开到各自槽位），写入 `system_agent` 的托管槽位；
- 「保存并同步」弹出确认框，列出本次变更摘要（停用 / 启用 / 减少模型数 / 默认模型前后值 / 槽位变更）与影响人数；
- 「还原」回到上次保存的状态。

### 设备

- 设备池列表：名称、主机、平台、在线、授权范围（全员 / 指定人 / 未分配）、最近活跃；
- 行 → 分配抽屉：切换「全员 / 指定人」，指定人模式按工号或邮箱搜索勾选；
- 撤销授权：运行中的任务不中断，下一次刷新用户就看不到；
- 「注册设备…」弹窗给出 `lh device pool register` / `grant` 三条命令，说明非管理员执行返回 `FORBIDDEN`；
- 「预览空态」演示池里还没有设备时的提示。

### 审计日志

- 时间倒序，按操作者 / 目标 / 动作搜索，按账号 / 配置 / 设备筛选；
- 点行展开前后值与来源 IP；
- 说明：只在写操作成功后落库，失败不记录；Key、token 之类敏感值不入库。

## 普通用户视角

左下角开关切到「普通用户视角」，用来演示非管理员看到的样子：

- 侧栏不再出现「AI 服务」；
- 顶部提示条说明「直达 URL 会被重定向，服务端写入同样返回 `FORBIDDEN`」；
- 账户徽标变为当前预览用户（`lina`）。

> 默认值取自当前仓库的 `DEFAULT_SETTINGS`、`DEFAULT_AGENT_CONFIG`、`DEFAULT_LLM_CONFIG` 与 `DEFAULT_SYSTEM_AGENT_CONFIG`，并按第四版设计里的 mock 用户 / 设备 / 审计数据渲染。
