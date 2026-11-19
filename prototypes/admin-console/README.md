# 管理员控制台交互原型

直接双击用浏览器打开 `index.html` 即可，无需构建、无需依赖。

## 视觉基线

原型不另造后台风格，直接复刻现有「设置」页：

- 外壳按 `src/features/Settings/Layout`：左侧 NavPanel（280px，`colorBgLayout` 背景，loose 密度：44px 页头、36px 导航项 / 14px 文字 / 28px 图标盒）+ 右侧 44px 页头；
- 侧栏分组按 `Settings/Layout/Body`：搜索框（`SearchBar variant="filled"`，32px 高、`fill-tertiary`）+ `Accordion`（分组间距 8px、`indicatorPlacement="inline"`、32px 分组标题）+ 每组内 `gap: 1px` 的导航项；
- 内容区 `MAX_WIDTH = 1024`，`paddingBlock: 24px 128px`、`paddingInline: 24px`；模板页字段行三列 `minmax(0, 1fr) 200px 28px`（标签 / 控件 / 锁定）；
- 卡片复刻 `@lobehub/ui` 的 `Form variant="filled" itemsType="group"`：外层 12px 圆角 `fill-quaternary` 承载，内层 `colorBgContainer` 卡片（`margin: 0 3px 3px`、8px 圆角、1px `colorBorderSecondary` 边框；浅色叠 4 层阴影，深色无阴影 —— 对应 `groupStyles.bodyFilledLight` 只在浅色挂载）；
- 颜色、圆角、阴影全部走 `--lobe-color-*` / `--lobe-radius*` / `--lobe-shadow-*` token，取值对齐 `@lobehub/ui` 的 `theme.css`（主色 `#222222`，深色下反转为 `#eeeeee`），右上角按钮切换深浅色。

## 可点击的内容

- 左侧导航：搜索过滤、分组折叠、折叠侧栏；「总览 / 用户 / 用户设置模板 / 审计日志」切换；
- 「用户设置模板」按真实设置页分组（21 个页面、5 个分组），逐项显示路径、默认值、可下发能力、锁定；
- 用户列表搜索、筛选（全部 / 管理员 / 已禁用 / 已自定义）；
- 点击任意用户行，打开 520px 详情抽屉；
- 详情抽屉内切换「概览 / 用户设置 / 权限 / 操作」；「用户设置」里可按真实设置页查看「当前值 vs 模板默认」并锁定字段；
- 「保存并应用…」打开应用范围确认框（仅补齐未设置项 / 强制覆盖 + 影响人数 + 自动跳过不可下发项）。

### 模板页分组

- 账号：外观 / 快捷键 / 数据统计
- 智能体：AI 服务商 / 服务模型 / 技能 / 工具 / 记忆设置 / 标签
- 连接：集成 / 连接器
- 运行资源：设备 / 订阅账号 / 环境 / 凭证管理
- 系统与开发者：存储 / 回收站 / 高级 / API Key / 实验室 / 关于

设备本地 / 用户私有 / 用户数据 / 服务端配置字段会明确标注，并且不会出现在批量应用里。

设计与实现方案见仓库根目录 [`ADMIN_CONSOLE_DESIGN.md`](../../ADMIN_CONSOLE_DESIGN.md)。

> 这是纯静态原型，不连接真实接口，也不会修改任何产品代码。默认值来自当前仓库的 `DEFAULT_SETTINGS`、`DEFAULT_PREFERENCE`、`DEFAULT_AGENT_CONFIG`、`DEFAULT_LLM_CONFIG`、`DEFAULT_SYSTEM_AGENT_CONFIG` 与 `LAB_FEATURES`。
