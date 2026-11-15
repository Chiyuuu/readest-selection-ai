# Readest Selection-AI（选文问 AI 补丁）

给 [readest/readest](https://github.com/readest/readest)（AGPL-3.0）加一个**选中文字 → 问 AI**的工具，交互参考 Anx Reader，并顺带提供不依赖官方配额的 **AI 翻译**与**语境词典**。

## 这个补丁做什么

在书籍阅读界面选中文字后，选区工具栏新增「问 AI」按钮（默认可见，也可设为长按快捷动作）。点开后：

- **提问**：就选中的段落自由提问，支持连续追问
- **解释**：讲含义、典故、句法与易误解处
- **AI 翻译**：中↔英互译，用你自己的模型
- **语境词典**：结合所在句子给读音、词性、**该语境下的确切义项**、为何其他义项不适用、贴切译法、仿写例句
- **总结**：要点概括

小屏 / 横屏空间不足时自动改用底部抽屉，和大屏一致可用。

## 合规边界（请务必读）

- **不包含、也不提供任何"解锁官方付费功能"的补丁。** 本仓库不修改、不绕过 `utils/access` 中的 `isCustomTranslatorAllowed`、订阅校验、DeepL/Google/Azure 翻译配额或任何授权逻辑。
- AI 翻译与语境词典是**本补丁自己实现的新功能**，只请求**你自己填写**的 OpenAI 兼容端点；请求经 `@tauri-apps/plugin-http` 从 Rust 侧发出，绕过 Android WebView 的 CORS 与明文限制，不经 Readest 服务端、不消耗官方额度。
- 上游 Readest 为 **AGPL-3.0**。本仓库只存放补丁脚本，构建时从上游拉取完整源码；衍生版本须继续遵守 AGPL-3.0。若分发修改后的 App，请一并提供对应源码。
- 没有内置任何 API Key。Key 只存在你设备的 `localStorage`（或官方「设置 → AI」的配置里）。

## 配置 AI 接口

第一次点「问 AI」→ 右上角齿轮，填三项即可：

| 字段 | DeepSeek 示例 |
| --- | --- |
| Base URL | `https://api.deepseek.com/v1` |
| API Key | 你自己的 key（弹窗内有「填入 DeepSeek 预设」一键填好前两项） |
| 模型 | `deepseek-chat` |

任何 OpenAI 兼容端点都可以：OpenRouter、Ollama（`/v1`）、vLLM、LiteLLM、自建网关。也可以点「改用设置 → AI 中的配置」，复用官方 `AIPanel` 里已填好的 OpenRouter/自定义凭据。Vercel AI Gateway 是私有协议，不支持。

## 构建 Android APK

本仓库的 Actions → **Build Readest AI Android APK** → Run workflow：

- `upstream_ref`：默认 `main`，可锁定某个 tag 以复现
- `abi`：默认 `aarch64`（骁龙 8 Gen 2 的 Tab S9 / 多数现代手机都是这个）
- `publish_release`：默认开，构建完发到 Releases，直接下载 APK

流水线会：拉取上游源码与子模块 → 装 JDK 17 / NDK 28.2.13676358 / Rust Android target → `pnpm tauri android init` → 应用本补丁 → 用临时自签名 keystore 构建并签名 → 上传 Artifact 与 Release。约 30–90 分钟。

APK 是**自签名**的，安装时 Android 会提示允许"安装未知应用"。后续升级请复用同一 keystore，否则需要先卸载。

## 补丁如何工作

`patch/apply.mjs` 对上游源码做 20 处**精确锚点**替换 + 新增 2 个文件。锚点必须唯一匹配，上游改动导致失配时会明确报错而不是生成残缺代码；脚本可重复运行（幂等）。

改动的文件：

| 文件 | 改动 |
| --- | --- |
| `src/types/annotator.ts` | 新增工具类型 `ai` |
| `.../annotator/AnnotationTools.tsx` | 新增「问 AI」按钮 |
| `src/utils/annotationToolbar.ts` | 让 `ai` 进入可用与默认工具栏 |
| `.../annotator/Annotator.tsx` | 弹窗状态、定位、按钮分发、JSX 挂载 |
| `src/services/ai/selectionQuery.ts` | **新增**：OpenAI 兼容流式请求 / 任务提示词 / 自动降级重试 |
| `.../annotator/AIQueryPopup.tsx` | **新增**：对话式弹窗与内置配置面板 |
| `src-tauri/tauri.conf.json` | 去掉本地构建不需要的 Sentry sourcemap 上传步骤 |

本地复现：

```bash
git clone --recurse-submodules https://github.com/readest/readest.git
node patch/apply.mjs ./readest
cd readest && pnpm install --frozen-lockfile
cd apps/readest-app && pnpm tauri android build -t aarch64
```

## 致谢

上游 [readest/readest](https://github.com/readest/readest) 与全体贡献者。本补丁只是挂载在已有选区与 AI 基础设施之上的一层薄封装。
