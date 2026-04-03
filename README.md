# Chat2Skills

一个基于 TypeScript、Next.js、shadcn/ui 和 Vercel AI SDK 的本地工作台，用来把问卷回答整理成多种 skill 文档。

## 功能

- 自动读取项目根目录的 `QUESTION.md`，并解析其中的问题。
- 支持 Anthropic、OpenAI、Google Gemini 任一可用接口进行 AI 整理。
- 支持解析类型下拉选择：`OpenClaw skill`、`Claude skill`、`GPT prompt skill`、`全部解析`。
- 每次解析前先落盘 `storage/outputs/experience.json`。
- 解析结果按类型落盘：`openclaw.md`、`claude.md`、`gpt.md`。
- 导出规则：
	- 选择单个类型时，导出对应单个 `.md` 文件。
	- 选择 `全部解析` 时，导出包含 3 个 `.md` 的 `skills-all.zip`。

## 启动

1. 安装依赖：

```bash
npm install
```

2. 配置环境变量：

```bash
copy .env.example .env.local
```

然后在 `.env.local` 中填写：

```bash
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
OPENAI_API_KEY=your_openai_key_here
OPENAI_MODEL=your_gateway_supported_model
OPENAI_BASE_URL=https://your-openai-compatible-gateway/v1
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key_here
GOOGLE_MODEL=gemini-2.5-flash
```

说明：模型只读取环境变量，不再使用前端默认值。

3. 启动开发服务器：

```bash
npm run dev
```

打开 `http://localhost:3000`。

## 使用流程

1. 页面会自动读取项目根目录的 `QUESTION.md` 并生成问题。
2. 选择一个问题。
3. 输入回答后，在“提交并整理”按钮旁的下拉框选择解析类型。
4. 点击“提交并整理”，系统执行对应解析。
5. 可在整理结果区继续编辑，点击“保存”后同步到本地状态。
6. 点击“导出”：
	- 单类型：下载单个 `.md`。
	- 全部解析：下载 `skills-all.zip`。

## 本地输出目录

- 解析上下文：`storage/outputs/experience.json`
- 解析结果：`storage/outputs/openclaw.md`、`storage/outputs/claude.md`、`storage/outputs/gpt.md`
- 历史导出/状态文件：`storage/outputs/`、`storage/state.json`
