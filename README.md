# Chat2Skills

本项目目标是通过对话生成skill，从而使不同行业的人（哪怕对计算机0基础），也能将自己的专业知识转换为skill
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
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chat2skills?schema=public
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
OPENAI_API_KEY=your_openai_key_here
OPENAI_MODEL=your_gateway_supported_model
OPENAI_BASE_URL=https://your-openai-compatible-gateway/v1
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key_here
GOOGLE_MODEL=gemini-2.5-flash
```

说明：模型只读取环境变量，不再使用前端默认值。

存储路径说明：
- 本地默认写入 `./storage`。
- 在 Vercel 环境自动写入 `/tmp/chat2skills`（避免写入只读的 `/var/task`）。
- 可通过 `CHAT2SKILLS_STORAGE_ROOT` 自定义存储目录。

3. 启动开发服务器：

先生成 Prisma Client 并把表结构推到 PostgreSQL：

```bash
npm run db:generate
npm run db:push
```

再启动开发服务器：

```bash
npm run dev
```

打开 `http://localhost:4744`。

## Docker 部署

1. 构建镜像：

```bash
docker build -t chat2skill .
```

如果出现 `load metadata for docker.io/library/node:*` 这类网络错误，可改用镜像源：

```bash
docker build -t chat2skill --build-arg NODE_IMAGE=registry.cn-hangzhou.aliyuncs.com/library/node:20-alpine .
```

2. 运行容器：

```bash
docker run -d --name chat2skills -p 4744:4744 --env-file .env.local chat2skill
```

## Docker Compose 部署

项目已提供 `docker-compose.yml`，可直接启动：

```bash
docker compose up -d --build
```

停止并移除容器：

```bash
docker compose down
```

说明：`docker-compose.yml` 已将本地 `storage` 挂载到容器 `/app/storage`，用于持久化导入、解析和导出文件。
同时会启动一个 PostgreSQL 16 容器，默认连接串为 `postgresql://postgres:postgres@localhost:5432/chat2skills?schema=public`。

## 使用流程

1. 页面会自动读取项目根目录的 `QUESTION.md` 并生成问题。
2. 选择一个问题。
3. 输入回答后，在“提交并整理”按钮旁的下拉框选择解析类型。
4. 点击“提交并整理”，系统执行对应解析。
   - 在调用 AI 前，会先把当前原始问答和用户 IP 通过 Prisma 写入 PostgreSQL。
   - AI 分析完成后，会把生成出的 skill 回填到同一条数据库记录中。
5. 可在整理结果区继续编辑，点击“保存”后同步到本地状态。
6. 点击“导出”：
	- 单类型：下载单个 `.md`。
	- 全部解析：下载 `skills-all.zip`。
	- 导出前会检查页面上的 skill 是否被手工修改；如果内容有变更，则覆盖数据库中的 skill；如果没有变化，则不重复写库。

## 本地输出目录

- 解析上下文：`storage/outputs/experience.json`
- 解析结果：`storage/outputs/openclaw.md`、`storage/outputs/claude.md`、`storage/outputs/gpt.md`
- 历史导出/状态文件：`storage/outputs/`、`storage/state.json`

## Skill 分析记录表

分析时会写入 PostgreSQL 的 `SkillAnalysisRecord` 表，字段包括：

- `sourceFileName`
- `questionId`
- `questionText`
- `analysisMode`
- `providerId`
- `modelId`
- `ipAddress`
- `userAgent`
- `rawAnswers`（JSON）
- `userInput`
- `generatedSkill`
- `status`
- `lastError`
