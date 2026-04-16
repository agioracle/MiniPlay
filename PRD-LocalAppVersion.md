
# MiniPlay Native 产品需求文档 (PRD) v2.1

> **用一句话，生成微信小游戏。**

---

## 1. 产品概述 (Overview)

* **产品名称**：MiniPlay Native (微玩)
* **产品形态**：跨平台桌面客户端 (Electron)
* **一句话定位**：面向独立游戏创作者的本地 AI 工具，将自然语言描述转化为可发布的微信小游戏工程包。
* **核心策略**：采用"大脑本地化，算力云端化"的混合架构——项目文件、构建逻辑、Agent 决策全部运行在用户本地，仅将 LLM 推理外包至云端 API。零服务器成本，极速反馈循环。
* **核心壁垒**：
    * **零基础设施成本**：无需部署服务器或容器编排，用户的本机即是运行环境，单用户边际成本趋近于零。
    * **毫秒级迭代**：本地 Vite HMR 热重载，代码改动到预览刷新在毫秒级完成，远快于任何云端方案。
    * **数据主权**：源代码与创意资产物理隔离在用户本地，永不离开用户的机器（仅 LLM prompt 经过云端）。
    * **双端同源构建**：右侧预览直接挂载 `build:h5` 产物，打包成小游戏后效果 100% 还原，由 `@aspect/rollup-plugin` 自动处理平台差异。

## 2. 目标用户与核心场景 (Users & Scenarios)

### 2.1 用户画像

| Persona | 描述 | 核心诉求 | 技术水平 |
| :--- | :--- | :--- | :--- |
| **小林 - 独立游戏创作者** | 有游戏设计直觉，会简单编程但不擅长工程化 | 快速把玩法原型变成可发布的小游戏 | 中等 |
| **阿美 - 内容创业者** | 短视频/自媒体博主，想通过小游戏拓展变现渠道 | 零代码完成，只关心创意和变现 | 低 |
| **老王 - 小工作室负责人** | 管理 2-3 人团队，需要快速产出轻量休闲游戏试水市场 | 降低试错成本，加快迭代速度 | 中高 |

> **MVP 聚焦小林**：他是最核心的早期采用者——有足够的技术基础安装桌面应用和配置 API Key，同时又真切感受到从 Phaser 代码到微信小游戏之间的工程鸿沟之痛。阿美和老王作为后续扩展目标。

### 2.2 核心用户旅程

```
下载安装 MiniPlay Native → 首次启动
    → 环境自检（Auto-Hydration 静默配置工具链）
    → 输入 LLM API Key
    → 描述游戏创意（或选择 FlappyBird 模板）
    → PM Agent 通过对话澄清需求，生成 GDD
    → Coder Agent 在本地根据 GDD 自动生成/修改代码
    → 本地 Vite 热重载 → 实时预览 (iframe)
    → 用户提出修改意见 → PM Agent 更新 GDD → Coder Agent 增量修改
    → [循环迭代至满意]
    → 一键导出微信小游戏工程包 (.zip)
    → 解压后在微信开发者工具中预览/发布
```

### 2.3 核心场景 (User Stories)

* **US-01**：作为小林，我想用一句话描述我的游戏想法，系统帮我补全细节并生成可玩原型，这样我可以在 10 分钟内看到第一个可交互版本。
* **US-02**：作为小林，我想在预览中发现问题时直接用自然语言说"这个角色跳得太高了"，系统自动帮我调整，这样我不需要手动调参。
* **US-03**：作为小林，我想一键导出微信小游戏包，这样我可以在微信开发者工具中进行真机测试。
* **US-04**：作为小林，我想随时回退到之前任意一个版本，这样我不怕实验性修改搞坏项目。
* **US-05**：作为小林，我的代码和创意不应该离开我的电脑，这样我的未发布游戏创意是安全的。

## 3. 设计哲学 (Design Philosophy)

* **新极简主义 (Neo-Minimalism)**：界面摒弃一切冗余装饰，仅保留对话框与游戏预览。通过高呼吸感的排版，将用户的注意力锁定在创意迭代上。
* **技术黑盒化 (Tech Shielding)**：普通用户不应感知到 `Node.js`、`pnpm` 或 `opencode` 的存在。所有环境依赖的检测、下载、配置均由系统主进程在后台静默完成。
* **隐私作为底色 (Privacy by Default)**：源代码及未发布的创意资产物理隔离在用户本地。仅 LLM prompt 文本经过云端 API，不含项目全量源码。
* **渐进式复杂度 (Progressive Complexity)**：从最小可行方案开始交付价值，每个版本只增加经用户反馈验证过的功能。宁可砍功能，不可拖上线。
* **逻辑优于美术 (MVP 阶段)**：核心算力与 Token 全局倾斜于打磨核心玩法循环 (Core Loop)，系统内置基础几何图形库，不在 MVP 阶段引入复杂的生成式 AI 美术。

## 4. 精益验证策略 (Lean Validation)

> *"不要从产品创意开始。从人开始。"*

在启动 MVP 开发之前，先通过手动服务验证需求真实性。

### 4.1 阶段一：手动服务 (Manual) — 第 1 周

**你就是产品。** 在写任何 Electron 代码之前，先手动为真实客户交付价值。

| 行动 | 具体操作 | 成功指标 |
| :--- | :--- | :--- |
| 发布服务帖 | 在 indienova、V2EX、掘金等社区发帖："我帮你把游戏创意变成微信小游戏 .zip，48 小时交付，前 3 位免费，之后 ¥499/个" | 5+ 人响应 |
| 手动交付 | 通过微信/腾讯会议与客户沟通需求，手动使用 `phaser-wx` CLI 生成项目、编写代码、构建导出 | 3+ 份 .zip 成功交付 |
| 记录流程 | 每次交付记录：问了什么问题、做了什么决策、耗时最长的步骤、客户最关心什么 | 形成可复现的流程文档 |

### 4.2 阶段二：流程化 (Processized) — 第 2 周

**写在纸上的魔法流程。** 将手动交付中总结的模式固化为可复用的流程。

| 行动 | 具体操作 | 成功指标 |
| :--- | :--- | :--- |
| 提炼 System Prompt | 基于 3 次真实交付的问答模式，编写 PM Agent 的 System Prompt v1 | Prompt 能覆盖 80% 的常见问答路径 |
| 固化 GDD 模板 | 基于交付经验确定 GDD Schema 的最小必要字段 | GDD 模板经 3+ 次验证可用 |
| 收费验证 | 将价格提升至 ¥499-999，观察是否仍有付费意愿 | 1+ 位付费客户 |
| 客户访谈 | 向每位客户问："如果有一个工具让你自己 10 分钟内完成，你愿意每月付 ¥99 吗？" | 收集真实反馈 |

### 4.3 阶段三：产品化 (Productized) — 第 3 周起

**只自动化已经手动验证过的流程。** 此时启动 MVP 开发。

| 原则 | 说明 |
| :--- | :--- |
| 每个功能必须对应一个手动交付中的真实痛点 | 不允许构建"也许将来有用"的功能 |
| 手动阶段的流程文档直接映射为产品功能 | 问答流程 → PM Agent Prompt，代码模式 → Coder Agent 模板 |
| MVP 上线后持续收集反馈 | 基于反馈决定 V1.5 优先级 |

## 5. 系统架构 (System Architecture)

### 5.1 架构总览

系统采用"大脑本地化，算力云端化"的混合模式。所有进程运行在用户本地 Electron 应用内，仅 LLM 推理调用云端 API。

```
┌─ Electron 应用 ─────────────────────────────────────────────────┐
│                                                                  │
│  ┌─ 渲染进程 (Renderer) ────────────────────────────────────┐   │
│  │                                                           │   │
│  │  ┌──────────────────┐       ┌───────────────────────────┐│   │
│  │  │   Prompt Flow    │       │      Live View            ││   │
│  │  │   (对话面板)      │       │  (9:16 手机外壳预览)       ││   │
│  │  │                  │       │                           ││   │
│  │  │  · 模板选择       │       │  ┌─────────────────────┐ ││   │
│  │  │  · 对话流         │       │  │  iframe:            │ ││   │
│  │  │  · 参数微调       │       │  │  localhost:5173     │ ││   │
│  │  │                  │       │  │  (Vite HMR)         │ ││   │
│  │  └────────┬─────────┘       │  └─────────────────────┘ ││   │
│  │           │                 └───────────────────────────┘│   │
│  └───────────┼──────────────────────────────────────────────┘   │
│              │ IPC (contextBridge)                               │
│  ┌───────────▼──────────────────────────────────────────────┐   │
│  │                                                           │   │
│  │  主进程 (Main Process)                                    │   │
│  │                                                           │   │
│  │  ┌──────────────────┐     ┌────────────────────────────┐ │   │
│  │  │   PM Agent       │     │   进程管理器                │ │   │
│  │  │   (本地大脑)      │     │   (Process Manager)        │ │   │
│  │  │                  │     │                            │ │   │
│  │  │  · Tool Calling  │     │  · Vite Dev Server 生命周期 │ │   │
│  │  │  · GDD 维护      │     │  · 构建任务调度              │ │   │
│  │  │  · 意图理解       │     │  · 环境检测与修复           │ │   │
│  │  └────────┬─────────┘     └──────────┬─────────────────┘ │   │
│  │           │                          │                    │   │
│  │  ┌────────▼──────────────────────────▼─────────────────┐ │   │
│  │  │                                                      │ │   │
│  │  │  本地文件系统 (用户项目目录)                            │ │   │
│  │  │                                                      │ │   │
│  │  │  ~/.miniplay/                                         │ │   │
│  │  │  ├── config.json          (全局配置: API Key, 偏好)    │ │   │
│  │  │  ├── projects.json        (项目索引: 路径, 最近打开)    │ │   │
│  │  │  └── projects/{project-name}/                         │ │   │
│  │  │      ├── .miniplay/                                   │ │   │
│  │  │      │   ├── conversations.jsonl  (对话记录)           │ │   │
│  │  │      │   └── versions.json        (版本元数据索引)     │ │   │
│  │  │      ├── docs/GDD.md       (PM ↔ Coder 协作契约)      │ │   │
│  │  │      ├── src/scenes/       (场景代码)                  │ │   │
│  │  │      ├── src/entities/     (实体代码)                  │ │   │
│  │  │      ├── src/config/       (配置文件)                  │ │   │
│  │  │      ├── public/assets/    (本地资源)                  │ │   │
│  │  │      ├── public/remote-assets/ (远程资源)              │ │   │
│  │  │      ├── phaser-wx.config.json (构建配置)              │ │   │
│  │  │      ├── dist-h5/          (H5 预览产物)               │ │   │
│  │  │      ├── dist-wx/          (微信小游戏导出产物)         │ │   │
│  │  │      └── .git/             (版本快照实体)              │ │   │
│  │  │                                                      │ │   │
│  │  └──────────────────────────────────────────────────────┘ │   │
│  │                                                           │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │ HTTPS (API Key)
                               ▼
                    ┌─────────────────────┐
                    │   云端 LLM API       │
                    │   (Claude / GPT-4o)  │
                    │                     │
                    │   仅传输 prompt 文本  │
                    │   不传输项目源码全量   │
                    └─────────────────────┘
```

### 5.2 PM 智能体 (本地大脑 / Brain)

* **职责定位**：充当产品经理与文档管理员。与用户进行自然语言交互，利用启发式问题补全游戏参数。
* **运行环境**：Electron 主进程 (Node.js)，通过 IPC 桥接与渲染进程通信。
* **推理引擎**：通过 Vercel AI SDK 调用云端 LLM API（Claude Sonnet / GPT-4o），驱动 Tool Calling 状态机，负责意图理解与 GDD 维护。
* **文档锚定 (Living Document)**：维护唯一的 `docs/GDD.md`。每次迭代仅修改对应模块，末尾追加 `## Latest Patch`。
* **指令下发**：将 GDD 更新转化为结构化操作指令，通过本地进程间通信发送给 Coder Agent。

### 5.3 工程智能体 (本地肌肉 / Coder)

* **职责定位**：充当全栈工程师。接收 PM Agent 指令后，直接在本地文件系统中进行增量代码修改。
* **运行环境**：由 Electron 主进程通过 `execa` 调起的本地 OpenCode Agent 进程。
* **执行方式**：直接读取本地 `docs/GDD.md` 的 `Latest Patch`，自主规划并修改 `src/` 下的代码文件。
* **修改范围**：限定在 `src/scenes/`、`src/entities/`、`src/config/` 目录下。严禁破坏 `phaserjs-webgl-transform` 底层环境注入规范。

### 5.4 智能体协作协议

PM Agent 与 Coder Agent 通过主进程内的 JSON 消息进行协作，协议轻量、直传、无需中间服务。

**通信流**：

```
PM Agent (主进程)              Coder Agent (子进程, OpenCode)
   │                              │
   │── 结构化指令 (JSON) ────────→│
   │   {action, gdd_patch,        │
   │    target_files}             │── 读取 docs/GDD.md
   │                              │── 规划修改范围
   │                              │── 执行代码修改 (fs 直写)
   │                              │── 触发 Vite HMR
   │   ←── 状态回报 (JSON) ──────  │
   │   {status, changed_files,    │
   │    errors}                   │
```

**指令格式 (PM → Coder)**：

```json
{
  "action": "patch",
  "project_path": "/Users/xxx/MiniPlay-Projects/my-game",
  "gdd_patch": {
    "section": "Entities",
    "operation": "update",
    "content": "将玩家跳跃高度从 300 调整为 200，添加二段跳能力"
  },
  "target_hint": ["src/entities/Player.js", "src/config/physics.js"]
}
```

**状态回报 (Coder → PM)**：

```json
{
  "status": "completed",
  "changed_files": ["src/entities/Player.js", "src/config/physics.js"],
  "build_status": "success",
  "errors": null
}
```

**状态码**：

| 状态 | 含义 | 前端展示 |
| :--- | :--- | :--- |
| `agent:planning` | Coder Agent 规划修改 | 对话面板: "AI 正在分析需求..." |
| `agent:coding` | Coder Agent 编写代码 | 对话面板: "正在修改代码..." |
| `build:compiling` | Vite 编译中 | 对话面板: "编译中..." |
| `build:success` | 构建成功 | 预览自动刷新 |
| `build:failed` | 构建失败 | 触发异常自愈流程 |
| `qa:retrying` | 自动修复重试中 | 对话面板: "正在自动修复..." |

## 6. GDD 文档契约 (GDD Schema)

`docs/GDD.md` 是 PM Agent 与 Coder Agent 之间的**核心协作契约**，结构定义如下：

```markdown
# Game Design Document: {游戏名称}

## Meta
- template: {模板类型, e.g. "endless-runner" | "match-3" | "idle-clicker" | "custom"}
- engine: phaser@3.x
- target: wechat-minigame
- aspect_ratio: 9:16

## Core Loop
- 核心玩法描述（1-3 句话）
- 胜利/失败条件
- 计分规则

## Entities
- 实体列表（玩家、敌人、道具...），每个实体包含：
  - name, visual (几何描述或精灵引用), behavior (行为逻辑)

## Scenes
- 场景列表及其转场逻辑
  - BootScene → GameScene → GameOverScene

## Controls
- 输入方式：touch | swipe | tap
- 操控映射描述

## Difficulty
- 难度曲线参数（速度递增率、生成频率等）

## Assets
- 内置几何图形引用列表
- 本地资源 (public/assets/)：小体积、高频使用（UI 图标、音效等）
- 远程资源 (public/remote-assets/)：大体积资源（背景音乐、高清图片等），运行时从 CDN 加载

## UI Layout
- 安全区域适配策略：UI 元素定位在安全区域内，游戏内容全屏渲染
- 使用 GameGlobal.__safeArea 获取设备安全区域信息

## Latest Patch
- [{时间戳}] {变更摘要}
- 影响模块：{Scenes | Entities | Controls | ...}
- 具体修改指令
```

**Schema 管理规则**：
* MVP 冻结以上核心结构，后续只允许新增可选字段，不允许破坏性变更。
* `Latest Patch` 为追加写入模式，Coder Agent 执行完毕后标记 `[DONE]`，PM Agent 不再修改已完成的 Patch。

## 7. MVP 核心功能需求 (Functional Requirements)

### 7.1 MVP 范围定义

MVP 的目标：**跑通"对话→GDD→代码生成→预览→导出"完整闭环**，交付一个可独立使用的桌面产品。

**MVP 功能边界**：

| 纳入 MVP | 推迟至后续版本 |
| :--- | :--- |
| Auto-Hydration 环境自愈 | 多模板 (Match-3 / Idle Clicker)→ V1.5 |
| PM Agent (Tool Calling + GDD 维护) | 多项目管理与切换 → V1.5 |
| Coder Agent (OpenCode 本地集成) | 触摸模拟（鼠标映射触摸事件）→ V1.5 |
| FlappyBird 单模板 + 自由描述模式 | 资产拖拽导入 → V1.5 |
| 启发式参数引导 | 自动唤起微信开发者工具 → V1.5 |
| GDD Schema + Latest Patch 协议 | License 系统 / 付费解锁 → V2.0 |
| 本地 Vite HMR 实时预览 | CDN 自动上传 → V2.0 |
| 异常自愈闭环（3 次自动重试） | 资产管理面板 → V2.0 |
| 一键导出微信工程包（含分包、体积校验） | 流量主组件注入 → V2.0 |
| Git 自动 Commit + 时间机器版本回放 | 自动更新 (autoUpdater) → V2.0 |

### 7.2 自动化环境自愈 (Auto-Hydration)

* **静默安装流**：
    1. 应用启动时检测本地是否有兼容的 `Node.js` 环境, 检测是否有安装了 `opencode` 及 `phaserjs-webgl-transform` 工具链。
    2. 若无，自动在应用私有支持目录（`~/Library/Application Support/MiniPlay/` 或 `%APPDATA%/MiniPlay/`） 自动安装 Node 环境。
    3. 若无，自动部署安装 `opencode` 及 `phaserjs-webgl-transform` 工具链（`git clone https://github.com/agioracle/phaserjs-webgl-transform.git` + `npm link`）。
* **环境变量隔离**：通过修改会话级 `process.env.PATH`，确保 MiniPlay 的工具链不与用户系统全局环境冲突。
* **首次启动体验**：展示极简进度指示（"正在准备开发环境..."），30 秒内完成。后续启动跳过此步骤。

### 7.3 桌面端交互布局 (UI/UX)

#### 7.3.1 首页

* 快速开始对话框：用户输入一句话描述游戏创意，或选择 FlappyBird 模板。
* 最近项目列表（若有历史项目）。
* API Key 配置入口（首次启动引导设置）。

#### 7.3.2 游戏开发页：左右双轨视图

* **左侧 (40%) — Prompt Flow**：
    * PM Agent 对话流（含工具调用状态实时展示，如"正在更新 GDD..."、"正在修改代码..."）
    * 参数微调控件（当 PM Agent 需要用户确认具体参数时动态展示，如滑块、下拉选择器）
* **右侧 (60%) — Live View**：
    * 9:16 比例手机外壳容器，实时加载本地 Vite HMR 预览

#### 7.3.3 顶栏控制台

* **时间机器 (Time Travel)**：显示历史版本列表 (V1, V2, V3...)，由本地 Git 自动 Commit 驱动。点击可瞬间回滚文件状态，预览自动刷新。
* **导出按钮**：醒目的 `📦 导出微信小游戏` 核心动作按钮。

### 7.4 模板与参数系统

#### 7.4.1 MVP 内置模板

| 模板 | 类型 | 核心机制 | 复杂度 |
| :--- | :--- | :--- | :--- |
| **FlappyBird** | 跑酷 | 重力 + 障碍生成 + 计分 | 低 |
| **自由模式** | 自定义 | PM Agent 从零引导 | 高 |

> Match-3 和 Idle Clicker 模板推迟至 V1.5，MVP 用一个模板验证全链路。

#### 7.4.2 启发式参数引导

PM Agent 在对话中通过结构化问题逐步补全游戏参数：

| 引导阶段 | 问题示例 | 写入 GDD 模块 |
| :--- | :--- | :--- |
| 主题确认 | "你想做什么主题的跑酷？太空？森林？赛博朋克？" | Meta |
| 玩法细化 | "玩家通过什么方式躲避障碍？跳跃？滑行？左右移动？" | Core Loop, Controls |
| 节奏设定 | "你想要轻松休闲还是紧张刺激的节奏？" | Difficulty |
| 视觉风格 | "偏好几何极简、像素风、还是扁平卡通？" | Entities (visual) |
| 计分规则 | "按存活时间计分，还是收集金币计分？" | Core Loop |

### 7.5 极速迭代管线 (Local Pipeline)

#### 7.5.1 项目初始化

1. 用户选择模板或描述创意后，PM Agent 完成 GDD 初稿。
2. 主进程调用 `phaser-wx new {project-name}` 在本地生成模板骨架（含 `src/`、`public/assets/`、`public/remote-assets/`、`phaser-wx.config.json` 等标准结构）。
3. PM Agent 将 GDD 写入项目 `docs/GDD.md`，并初始化 `phaser-wx.config.json`。

#### 7.5.2 代码覆写 (Code Mutation)

* Coder Agent (OpenCode) 根据 GDD `Latest Patch` 进行文件级增量修改。
* 修改范围限定在 `src/scenes/`、`src/entities/`、`src/config/` 目录下。
* 严禁破坏 `phaserjs-webgl-transform` 底层环境注入规范，包括：
    * 不得修改 `@aspect/adapter` 自动注入的 Phaser 配置（WebGL 强制、WebAudio 禁用、图片直加模式等）。
    * 不得修改 `phaser-wx.config.json` 中的构建级配置（除非 PM Agent 显式指令）。
    * 主入口 `src/main.js` 仅注册首屏 BootScene，其他场景通过分包动态加载。

#### 7.5.3 预览热重载

1. 项目初始化后，主进程自动拉起 `npm run dev`（Vite 开发服务器，支持 HMR 热重载）。
2. 开发服务器注入 `scale: { mode: FIT, autoCenter: CENTER_BOTH }` 适配 9:16 预览视窗（由 `@aspect/rollup-plugin` H5 目标自动处理）。
3. 代码修改后 Vite HMR 自动热重载，**毫秒级刷新**，无需等待云端构建。

#### 7.5.4 版本快照

* 每次 Coder Agent 完成一轮修改并通过构建验证后，主进程自动执行 `git commit`，生成带语义标签的版本快照。
* 版本列表在顶栏"时间机器"实时展示，点击即可回滚预览。

### 7.6 异常处理 (Error Handling)

```
Coder Agent 完成代码修改
    │
    ▼
Vite HMR 自动重载
    │
    ├─ 成功 → 预览正常刷新
    │
    └─ 失败 → 拦截错误
              │
              ├─ 构建期错误 (Vite 编译错误)
              │   → 将错误日志 + 相关源码 + GDD 状态 打包
              │   → 发送给 Coder Agent 自动修复
              │   → 最多重试 3 次
              │
              └─ 运行时错误 (iframe console.error)
                  → 通过 postMessage 捕获
                  → 同上自动修复流程

              超过 3 次仍失败
              → 在对话面板展示简化错误摘要
              → PM Agent 建议：简化玩法 / 回退版本
```

**错误分类**：
* **Fatal**（阻断构建）：语法错误、模块缺失、类型错误 → 触发自动修复。
* **Warning**（不阻断但记录）：性能警告、废弃 API → 记录至日志，不触发修复。
* **Runtime**（运行时崩溃）：iframe 内 `window.onerror` + `unhandledrejection` 捕获 → 触发自动修复。

### 7.7 一键导出微信工程包 (Export to WeChat)

#### 7.7.1 触发构建

用户点击 `📦 导出微信小游戏` 按钮，主进程执行 `npm run build`。

#### 7.7.2 底层转译

`@aspect/rollup-plugin` 接管 AST 变换，自动处理：
* 游戏配置注入：`type: Phaser.WEBGL`、`canvas: GameGlobal.__wxCanvas`、`parent: null`
* WebAudio 禁用：`audio: { disableWebAudio: true }`（桥接至 `wx.createInnerAudioContext()`）
* 图片直加模式：`loader: { imageLoadType: 'HTMLImageElement' }`（利用 `wx.createImage()` 原生路径加载）
* 缩放模式切换：H5 `scale: FIT` → 微信 `scale: NONE`
* 资源清单生成：扫描 `this.load.*` 调用，生成 `asset-manifest.json`，按体积阈值拆分本地/远程资源

#### 7.7.3 分包机制 (Subpackage)

微信小游戏**主包限制 4MB**，Phaser 引擎约 3.5MB，必须分包：

* **引擎分包**：Phaser 引擎独立为 `engine/phaser-engine.min.js` 分包（~3.5MB），主包仅保留启动入口 + 闪屏（~50KB）。
* **场景分包**：每个游戏场景独立为分包，通过 `wx.loadSubpackage()` 异步加载后动态注册。
* **资源自动分发**：构建工具自动扫描 `this.load.*` 调用，将对应资源复制到分包目录并重写路径，远程资源保持 CDN 加载。
* **配置方式**：在 `phaser-wx.config.json` 的 `subpackages` 数组中声明场景分包，构建工具自动处理。
* **启动流程**：闪屏（渐显动画）→ 异步下载引擎分包 → BootScene 加载 → 并行下载场景分包 → 场景跳转。

#### 7.7.4 体积校验

| 包体积 | 处理 |
| :--- | :--- |
| 主包 ≤ 4MB | 正常通过（引擎已分包，主包通常 ~50KB） |
| 总包 ≤ 16MB | 正常通过 |
| 总包 16-20MB | 告警，建议将大资源移至 `public/remote-assets/` |
| 总包 > 20MB | 阻断打包，列出体积 Top 5 资源并建议删减或迁移至远程加载 |

> 体积检查由 `@aspect/rollup-plugin` 在构建输出阶段自动执行。

#### 7.7.5 远程资产支持

* `public/remote-assets/` 下的资源在 `asset-manifest.json` 中标记为 `remote: true`，构建时不复制到输出目录。
* 运行时通过 `cdnBase + 路径` 从 CDN 下载（含 LRU 缓存 50MB + 指数退避重试）。
* 配置 `assets.remoteSizeThreshold`（默认 200KB），超阈值资源自动升级为远程资源。
* 用户导出 `.zip` 后，若存在远程资源，内含 `README.md` 附带 CDN 上传指南。

#### 7.7.6 最终交付物

`npm run build` 输出 `dist-wx/` 目录，打包为 `.zip` 供用户下载，包含：
* `game.js`（闪屏入口 + 适配器加载链）
* `phaser-wx-adapter.js`（运行时 DOM/BOM polyfill）
* `game-bundle.js`（主入口 + BootScene）
* `engine/phaser-engine.min.js`（引擎分包）
* 各场景分包目录（含场景代码 + 自动分发的资源）
* `game.json`（含 subpackages 声明）
* `project.config.json`
* `asset-manifest.json`（资源清单，标注本地/远程资源）

解压后即为标准微信开发者工具工程，零报错直接跑通。

### 7.8 数据持久化 (Data Persistence)

核心原则：**数据跟着项目走**。对话记录和版本元数据存储在项目目录内部，项目目录自包含——拷贝即完整备份。

#### 7.8.1 存储结构

```
~/.miniplay/
├── config.json                          # 全局配置 (API Key, 偏好设置)
├── projects.json                        # 项目索引 (路径, 最后打开时间, 缩略图)
│
└── projects/{project-name}/
    ├── .miniplay/                        # MiniPlay 项目元数据目录
    │   ├── conversations.jsonl           # 对话记录 (追加写入)
    │   ├── versions.json                 # 版本元数据索引
    │   └── thumbnail.png                 # 项目缩略图 (首页展示用)
    ├── docs/GDD.md
    ├── src/
    ├── public/
    └── .git/                             # Git 仓库 (版本快照实体)
```

#### 7.8.2 对话记录 (conversations.jsonl)

采用 **JSONL（JSON Lines）** 格式，每条消息一行，追加写入：

```jsonl
{"id":"msg_001","role":"user","content":"做一个太空主题的跑酷","ts":"2026-04-14T10:00:00Z"}
{"id":"msg_002","role":"pm","content":"好的！我来帮你规划...","ts":"2026-04-14T10:00:03Z","tool_calls":[{"name":"update_gdd","section":"Meta"}]}
{"id":"msg_003","role":"system","content":"代码修改完成，已更新 3 个文件","ts":"2026-04-14T10:01:15Z","ref_version":"v3"}
{"id":"msg_004","role":"user","content":"跳得太高了，降低一半","ts":"2026-04-14T10:02:00Z"}
```

**选择 JSONL 而非 SQLite 的理由**：
* 追加写入，中途崩溃不会丢失全量数据。
* 纯文本格式，可被 Git 追踪 diff。
* 无需 native addon 依赖（SQLite 需要 `better-sqlite3`，增加 Electron 打包复杂度）。
* 单项目对话量在百条级别，性能不是瓶颈。

#### 7.8.3 版本元数据 (versions.json)

Git commit 存储代码快照实体，`versions.json` 维护**人类可读的版本索引**，供时间机器 UI 使用：

```json
{
  "versions": [
    {
      "version": "v1",
      "commit_hash": "a1b2c3d",
      "summary": "初始生成：太空跑酷，左右滑动躲避陨石",
      "gdd_sections_changed": ["Meta", "Core Loop", "Entities", "Scenes"],
      "files_changed": ["src/scenes/GameScene.js", "src/entities/Player.js"],
      "trigger_message_id": "msg_002",
      "ts": "2026-04-14T10:01:15Z"
    },
    {
      "version": "v2",
      "commit_hash": "d4e5f6g",
      "summary": "调整跳跃高度降低 50%",
      "gdd_sections_changed": ["Entities"],
      "files_changed": ["src/entities/Player.js"],
      "trigger_message_id": "msg_004",
      "ts": "2026-04-14T10:03:20Z"
    }
  ]
}
```

**`trigger_message_id`** 将版本与对话记录关联——用户在时间机器中点击某个版本时，对话面板自动滚动并高亮触发该版本的那条消息。

#### 7.8.4 项目索引 (projects.json)

全局项目索引供首页"最近项目"列表使用：

```json
{
  "projects": [
    {
      "name": "太空跑酷",
      "path": "~/.miniplay/projects/space-runner",
      "template": "flappy-bird",
      "last_opened": "2026-04-14T10:05:00Z",
      "version_count": 5,
      "thumbnail": "~/.miniplay/projects/space-runner/.miniplay/thumbnail.png"
    }
  ]
}
```

#### 7.8.5 历史项目恢复流程

用户从首页点击"最近项目"中的某个项目时：

```
读取 projects.json 获取项目路径
    │
    ▼
校验项目目录是否存在且完整
    │
    ├─ 目录不存在 → 提示"项目已被移动或删除"，从索引中标记为不可用
    │
    └─ 目录存在
        │
        ├─ 读取 .miniplay/conversations.jsonl → 恢复对话面板历史记录
        ├─ 读取 .miniplay/versions.json      → 恢复时间机器版本列表
        ├─ 读取 docs/GDD.md                  → 恢复 PM Agent 上下文
        ├─ 拉起 Vite dev server              → 恢复实时预览 (最新代码状态)
        │
        └─ 完成：用户看到完整的对话历史、版本列表和实时预览
```

**恢复时间**：项目目录存在时，从点击到完整恢复预览 ≤ 5 秒（主要瓶颈为 Vite dev server 冷启动）。

## 8. 技术架构选型 (Tech Stack)

| 模块 | 选型 | 说明 |
| :--- | :--- | :--- |
| **应用外壳** | Electron | 接管本地进程管理与文件访问权限 |
| **渲染层** | Next.js (SSG) + TailwindCSS | 新极简主义视觉，静态导出嵌入 Electron |
| **智能体中枢** | Vercel AI SDK (Node.js) | 在主进程中驱动 PM Agent 的 Tool Calling 状态机，流式响应 |
| **进程管理** | `execa` / `node-pty` | 静默执行环境配置、构建指令，捕获日志流推送至渲染进程 |
| **工程执行** | 本地 OpenCode Agent | 作为子进程运行，负责代码文件增量修改 |
| **构建内核** | `@aspect/cli` (`phaser-wx`) + `@aspect/rollup-plugin` | 抹平 H5 与微信小游戏运行环境差异，统一编译管线 |
| **版本管理** | 本地 Git | 自动 Commit 驱动时间机器功能 |
| **数据存储** | JSONL + JSON 文件 (项目内) / `electron-store` (全局) | 对话记录 JSONL 追加写入，版本元数据 JSON 索引，全局配置 electron-store |

## 9. 演进路线图 (Roadmap)

### MVP (Month 1-2)

**目标**：跑通"需求对话→GDD→代码生成→预览→导出 .zip"完整闭环。主攻轻量休闲 2D 游戏。

- [ ] Auto-Hydration 环境自愈（静默安装 Node.js、opencode、phaser-wx 工具链）
- [ ] PM Agent 实现：Vercel AI SDK 驱动 Tool Calling 状态机、GDD 维护、启发式引导
- [ ] Coder Agent (OpenCode) 本地集成与调试
- [ ] GDD Schema 实现与 Latest Patch 协议
- [ ] Flappy'Bird 模板 + 自由描述模式
- [ ] 前端双栏布局：Prompt Flow + Live View (iframe 预览)
- [ ] 本地 Vite HMR 实时预览
- [ ] 异常自愈闭环（3 次自动重试）
- [ ] 一键导出微信工程包（含分包机制、体积校验、远程资产标记）
- [ ] Git 自动 Commit + 时间机器版本回放
- [ ] 数据持久化：对话记录 (JSONL)、版本元数据索引、项目索引与恢复流程
- [ ] 首页（快速开始 + 最近项目列表）
- [ ] API Key 配置与管理

### V1.5 — 体验打磨 (Month 2-4)

**目标**：扩展模板，优化核心体验，提升稳定性。

- [ ] 模板库扩展（Match-3、Idle Clicker、弹球等）
- [ ] 多项目管理与快速切换
- [ ] 预览交互增强（触摸模拟、旋转适配）
- [ ] 资产管理面板（上传、预览、替换、压缩）
- [ ] 本地资产拖拽导入（图片、音频）
- [ ] 远程资产 CDN 自动上传
- [ ] 对话体验优化（上下文记忆增强、多轮连贯性）
- [ ] 自动唤起微信开发者工具导入项目

### V2.0 — 商业化与增长 (Month 4-6)

**目标**：打通变现闭环，建立可持续商业模式。

- [ ] 内置 License 系统 + 付费解锁（API Key 代理模式 或 订阅制）
- [ ] 流量主组件可视化开关（激励视频 / Banner 广告 SDK 自动注入）
- [ ] 自动更新 (Electron autoUpdater)
- [ ] 跨平台支持优化（Windows 兼容性打磨）

## 10. 商业模式 (Business Model)

### 10.1 定价策略

| 阶段 | 模式 | 价格 | 说明 |
| :--- | :--- | :--- | :--- |
| **手动服务期** (验证阶段) | 人工代做 | ¥499/个游戏 | 验证付费意愿，积累案例 |
| **MVP** | 免费 + 用户自带 Key | ¥0 | 用户自行提供 LLM API Key，收集反馈 |
| **V2.0 正式版** | 买断 + 更新订阅 | ¥199 买断 / ¥99/年更新 | 或 ¥29/月订阅制 |
| **V2.0 Pro** | 订阅制 | ¥49/月 | 含 API 额度代理、CDN 存储等增值服务 |

### 10.2 成本结构 (本地版优势)

| 项目 | 云端 SaaS | 本地 Native |
| :--- | :--- | :--- |
| 服务器 | $200/月 | $0 |
| 容器编排 | $500-1500/月 | $0 |
| LLM API | $300-800/月 (平台代付) | $0 (用户自付) 或 代理加价 |
| 数据库 | $25/月 | $0 (本地存储) |
| CDN | $20/月 | $0 (V2.0 前不需要) |
| **总计 (100 DAU)** | **$1,050-2,550/月** | **~$0/月** |

> 本地版的核心经济优势：**在验证产品市场匹配度 (PMF) 之前，基础设施成本为零。**

## 11. 验收标准与 KPI

### 11.1 MVP 验收标准

| 编号 | 验收场景 | 通过条件 |
| :--- | :--- | :--- |
| AC-01 | 首次启动，无 Node.js 环境 | Auto-Hydration 30 秒内完成环境配置，无需用户手动操作 |
| AC-02 | 用户描述"太空主题跑酷，左右滑动躲避陨石" | PM Agent 在 3 轮对话内完成 GDD 初稿，10 分钟内生成可交互 H5 预览 |
| AC-03 | 用户在对话中说"让陨石速度加快 50%" | Coder Agent 增量修改代码，预览毫秒级刷新 |
| AC-04 | 预览中出现运行时错误 | 异常自愈机制在 3 次重试内修复，用户仅在对话面板看到"正在优化..."提示 |
| AC-05 | 用户点击"导出微信小游戏" | 30 秒内生成 .zip，解压后在微信开发者工具中零报错直接运行 |
| AC-06 | 用户点击时间机器回退到 V2 版本 | 预览在 3 秒内切换至目标版本的构建产物 |
| AC-07 | 用户关闭应用后重新打开历史项目 | 5 秒内完整恢复对话记录、版本列表和实时预览 |

### 11.2 核心 KPI

| 指标 | MVP 目标 | V1.5 目标 | 说明 |
| :--- | :--- | :--- | :--- |
| **首次可玩率** | ≥ 70% | ≥ 85% | 用户首次生成即得到可交互预览的比例 |
| **导出成功率** | ≥ 80% | ≥ 92% | 导出包在微信 DevTools 零报错运行的比例 |
| **异常自愈率** | ≥ 60% | ≥ 75% | 构建/运行时错误被自动修复的比例 |
| **平均生成时间** | ≤ 12min | ≤ 8min | 从描述到首次可玩预览 |
| **付费转化率** | ≥ 5% | ≥ 15% | Beta 用户转化为付费用户的比例 |

## 12. 风险矩阵 (Risk Matrix)

| 风险 | 等级 | 影响 | 缓解策略 |
| :--- | :--- | :--- | :--- |
| **AI 生成代码质量不稳定** | 🔴 高 | 预览失败率高 | 异常自愈 + 限定模板 + System Prompt 持续调优 + 手动验证阶段积累经验 |
| **Auto-Hydration 跨平台失败** | 🟡 中 | 用户卡在环境配置 | MVP 优先支持 macOS；提供"手动配置"降级指引 |
| **Electron 应用体积过大** | 🟡 中 | 下载转化率低 | Electron Builder 精简打包；考虑后续迁移 Tauri |
| **`@aspect/*` 未发布 npm** | 🟡 中 | 需 git clone + npm link | 应用内预置工具链；持续推进 npm 发布 |
| **LLM API 成本超出用户预期** | 🟡 中 | 用户抱怨 API 费用 | 提供用量估算指引；V2.0 提供代理模式 |
| **微信小游戏政策变更** | 🟢 低 | 导出格式需适配 | 构建管线模块化，转译规则可热更新 |
| **无人响应验证阶段** | 🔴 高 | 产品方向可能错误 | 在 3 个以上社区发帖；若手动服务无人响应则暂停项目、重新审视问题定义 |
| **GDD Schema 频繁变动** | 🟡 中 | 双 Agent 协作失败 | MVP 冻结核心 Schema，后续只扩展 |
