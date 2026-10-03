# 开发进展

更新日期：2026-10-03。当前扩展版本：1.11.0。

本文件是项目当前状态与验证记录的唯一进度入口；后续工作见 [开发计划](ROADMAP.md)。

## 当前状态

Preset Lab / Prompt Debugger V1 已实现，并完成一轮隔离 SillyTavern 实机验证。它将原始预设编辑与最终 Chat Completion 上下文分析放在同一弹窗中。真实提供商的超长上下文、多模态计量和扩展混用验证仍待补齐。

| 能力 | 当前实现 |
|---|---|
| Preset Editor | 继承上游编辑、启停、排序、统计、应用、保存及缝合功能 |
| Final Context | 展示最近一次标准生成链中的 messages、model、provider、捕获时间 |
| Summary | 消息数、总 token、自动按 role 汇总、快照差值；Context Limit 和 Usage 当前为 Unknown |
| Messages | 索引、role、token、字符数；默认折叠、单条/全部展开收起、复制单条 JSON |
| 多模态与工具结构 | 保留消息 JSON 结构；可读视图缩略大型 data URI，Raw 保留脱敏后的完整结构 |
| Token Ranking | 按逐条 token 降序排列，使用 CSS 水平条 |
| Raw | Pretty JSON、复制和下载 messages[] |
| Markdown | 独立文档，含模型、时间、角色统计与逐条内容 |
| Snapshot | localStorage 最多 10 份；配额不足时减少旧记录 |
| Diff | unchanged、modified、added、removed，显示前后 token 和内容 |

## 源码与模块

| 路径 | 职责 |
|---|---|
| index.js | 原预设功能、弹窗标签、Final Context 初始化与停用钩子 |
| style.css / manifest.json | UI 样式与 ST 扩展清单 |
| final-context/capture.mjs | 请求消息克隆、敏感字段脱敏、后台计量及更新通知 |
| final-context/tokenizer.mjs | 模型感知 tokenizer、当前 tokenizer 与显式估算回退 |
| final-context/analyzer.mjs | 消息展示、文本抽取、字符/角色统计与估算 |
| final-context/ui.mjs | Summary、Messages、Ranking、Raw、Snapshot、Diff 交互 |
| final-context/snapshots.mjs | 快照持久化与配额处理 |
| final-context/diff.mjs | 完整 JSON 哈希匹配、邻近消息轻量相似度匹配 |
| final-context/export.mjs | Markdown 导出与代码围栏处理 |
| tests/ | Node 单元测试、浏览器 smoke 页面、静态服务器和模拟后端 |

## 当前捕获与计量契约

核对过的宿主基线是 SillyTavern 1.19.0，提交 `06bde939fb1e9c4c8d8641d810f0a916b5bce127`。这是 2026-09-29 实机验证使用的版本记录，不代表所有 ST 版本均已验证。

该版本标准 Chat Completion 发送链为：

```text
ST 构建角色、世界书、历史、宏和扩展提示词
→ prepareOpenAIMessages
→ createGenerationParameters
→ CHAT_COMPLETION_SETTINGS_READY(generate_data)
→ JSON.stringify(generate_data)
→ POST /api/backends/chat-completions/generate
```

扩展在 `CHAT_COMPLETION_SETTINGS_READY` 克隆 messages，只保留安全的模型、provider、时间元数据。计量任务通过定时器启动，事件监听器不返回计量 Promise；解析或 tokenizer 失败不传播到生成链。每次捕获最多 4 个计量任务并行，较旧捕获停止派发后续任务。分析结果在当前捕获中缓存，长正文在展开时渲染。

普通字符串消息优先调用 ST 的 `/api/tokenizers/openai/count?model=...`，请求体为单条完整消息数组。失败后调用 ST 当前 `getTokenCountAsync`，再失败使用 UTF-8 字节估算。复杂 content 或 tool_calls 按可抽取文本计量并标为 estimated。Preset Editor 与 Final Context 共用加载到的当前 ST tokenizer，但 Final Context 优先考虑捕获模型。

快照键为 `preset-editor.final-context.snapshots.v1`。当前捕获只在运行时内存中，刷新后清空；显式保存的快照保留在同一浏览器来源的 localStorage。

Diff 先用 role、完整 JSON 长度与 FNV 哈希定位不变消息，并核对 JSON 相等；剩余消息只比较索引附近 ±5 范围内的同 role 候选，依据长度、首尾定长采样与位置评分匹配修改。未配对项标为新增或移除。

## 验证记录

### 2026-10-03 自动检查

- Node.js v26.7.0：`node --test tests/final-context.test.mjs`，6/6 通过。
- index.js、final-context/*.mjs、tests/*.mjs 的 `node --check` 通过。
- `git diff --check` 通过。
- 本仓库尚无 ESLint 配置与 npm 测试脚本；以上为语法和行为测试证据。

### 2026-09-29 隔离宿主与浏览器验证

| 原验收项 | 证据与边界 |
|---|---|
| 普通 Character + Preset | ST 1.19.0 + Seraphina + 本地模拟 OpenAI 后端，最终消息成功捕获 |
| World Info | 永久触发世界书文本出现在最终 system 消息中，该条显示 25 token |
| 长聊天历史 | 合成 701 条消息的浏览器列表验证；未进行同规模真实 ST 聊天历史测试 |
| 修改大型 prompt | 实机 Snapshot → 修改 → 应用 → 生成 → Diff，system 消息判为 modified，增加 620 token |
| Disable prompt | 实机禁用后判为 removed，该条减少 648 token；新增聊天轮次单独列出 |
| Streaming | ST 通过本地模拟后端完成流式回复，扩展捕获正常 |
| 捕获/计量异常 | 单元测试注入循环对象和抛错 tokenizer，确认监听器放行并明确估算 |
| 大上下文 | 浏览器 smoke 使用约 85 万字符、701 条消息，正文保持折叠；真实 100K–200K token 请求待验证 |

这些结果属于当时的验证记录，本次未重跑宿主 UI。隔离运行没有使用真实付费模型。

## 可复现检查

推荐 Node.js 22 或更高版本，在仓库根目录运行：

```powershell
node --test tests/final-context.test.mjs
node --check index.js
Get-ChildItem final-context,tests -Filter *.mjs -File | ForEach-Object { node --check $_.FullName }
git diff --check
```

浏览器 smoke 在 Windows 下运行 `node tests/ui-smoke-server.mjs`，然后打开 `http://127.0.0.1:8765/tests/ui-smoke.html`；应显示 PASS。该页面使用计量桩，不证明真实 tokenizer 精度。

实机 smoke 可运行 `node tests/mock-openai-server.mjs`，在独立 ST 测试数据目录配置 Custom OpenAI compatible，URL 为 `http://127.0.0.1:8767/v1`，模型为 `preset-lab-smoke`。完成测试后结束两个测试服务器。服务器均绑定 localhost。

## 已知限制

- 捕获点之后的其他事件监听器仍可能修改请求；iframe 直接请求及服务端 provider 转换不包含在当前捕获中。EJS 扩展组合尚未单独实测。
- ST tokenizer 服务端异常时可能返回没有估算标记的 token_count；客户端无法可靠识别这种内部回退。
- Total Tokens 是逐条计量之和；每次计量的 padding 可能重复累计，不能等同提供商实际输入 token 或账单。
- 多模态媒体成本、工具 schema、请求级字段及 provider 特有开销没有完整计量。
- Context Limit 尚无可靠模型信息源，当前固定显示 Unknown。
- 修改消息位置偏移过大或文本变化过多时，Diff 可能呈现为 added + removed；它不表示精确来源追踪。
- 快照由 localStorage 配额限制，超大上下文可能只保存较少份；损坏快照的结构校验仍较轻。
- 巨型 Raw JSON、导出、全部展开和首次克隆仍可能产生明显内存与主线程开销；尚无跨捕获 token 缓存。
- 明确的凭据字段会脱敏，正文中用户自行写入的秘密不能靠字段名识别。
- 上游随仓库附带的旧 CHANGELOG 部分描述了其他数据管理能力，不能据此认定当前扩展支持这些功能。

## 下一次交接

先读本文件和 ROADMAP，优先核对 P0 的捕获准确性与计量语义。新增行为需要补针对性测试并在隔离 ST 中验收；已有实机证据不能替代新版验证。
