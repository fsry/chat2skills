import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type UIMessage } from "ai";

import {
  getProviderCatalogItem,
  getConfiguredProviders,
  resolveModelId,
  resolveProviderId,
  type ProviderId,
} from "@/lib/ai-providers";
import {
  completeSkillAnalysis,
  failSkillAnalysis,
  upsertPendingSkillAnalysis,
} from "@/lib/services/skill-analysis-record-service";
import { getOutputsRoot } from "@/lib/storage-paths";
import type { RawQuestionAnswer, SingleAnalysisMode } from "@/lib/types";

const MAX_USER_INPUT_CHARS = 24000;
const OUTPUTS_ROOT = getOutputsRoot();

type AnalyzeSkillInput = {
  headers: Headers;
  messages?: unknown[];
  userInput?: string;
  questionId?: string;
  questionText?: string;
  sourceFileName?: string | null;
  providerId?: "anthropic" | "openai" | "google";
  analysisMode?: SingleAnalysisMode;
  rawAnswers: RawQuestionAnswer[];
};

function resolveAnalysisFileName(analysisMode: SingleAnalysisMode) {
  switch (analysisMode) {
    case "openclaw-skill":
      return "openclaw.md";
    case "gpt-prompt-skill":
      return "gpt.md";
    case "claude-skill":
    default:
      return "claude.md";
  }
}

function extractLatestUserText(messages: UIMessage[]) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");

  if (!latestUserMessage) {
    return "";
  }

  return latestUserMessage.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function createModel(providerId: ProviderId, modelId: string) {
  switch (providerId) {
    case "anthropic":
      return anthropic(modelId);
    case "openai": {
      const openaiProvider = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
      });

      return openaiProvider.chat(modelId);
    }
    case "google":
      return google(modelId);
    default:
      return anthropic(modelId);
  }
}

export async function analyzeSkill(input: AnalyzeSkillInput) {
  const analysisMode = input.analysisMode ?? "claude-skill";
  const resolvedProviderId = resolveProviderId(input.providerId);
  const provider = getProviderCatalogItem(resolvedProviderId);

  if (!process.env[provider.envKey]) {
    const availableProviderKeys = getConfiguredProviders().map((item) => item.envKey);

    throw new Error(
      availableProviderKeys.length > 0
        ? `当前请求模型不可用，已尝试切换到可用模型失败。已配置：${availableProviderKeys.join(", ")}。`
        : "请至少配置一个模型密钥：ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY。",
    );
  }

  const modelId = resolveModelId(provider.id);
  const messageInput = Array.isArray(input.messages)
    ? extractLatestUserText(input.messages as UIMessage[])
    : "";
  const userInput = (input.userInput?.trim() || messageInput).slice(0, MAX_USER_INPUT_CHARS);

  if (!userInput) {
    throw new Error("提交内容为空，请先填写回答后再提交。");
  }

  if (!input.questionId) {
    throw new Error("请先从顶部选择一个章节。");
  }

  const prompt = [
    input.questionText ? `章节上下文:\n${input.questionText}` : "",
    "用户输入:\n",
    userInput,
    "\n请基于以上内容生成最终结果。",
  ]
    .filter(Boolean)
    .join("\n\n");

  const modeInstructions = (() => {
    switch (analysisMode) {
      case "openclaw-skill":
        return [
          "输出目标：OpenClaw skill。",
          "请生成可直接用于 OpenClaw 的技能文档。",
          "当分析模式为 openclaw-skill 时，忽略其他结构建议，必须严格使用以下固定格式：",
          "---",
          "name:",
          "description:",
          "version:",
          "---",
          "",
          "# 角色",
          "",
          "# 使用场景",
          "",
          "# 工作流程",
          "",
          "# 经验规则",
          "",
          "# 输出风格",
          "输出文件名建议：OPENCLAW_SKILL.md。",
          "仅输出 Markdown 正文，不要额外解释。",
        ];
      case "gpt-prompt-skill":
        return [
          "输出目标：GPT prompt skill。",
          "请生成可直接复用的 GPT skill 文档。",
          "当分析模式为 gpt-prompt-skill 时，忽略其他结构建议，必须严格使用以下固定格式：",
          "# 角色",
          "",
          "# 背景",
          "",
          "# 任务",
          "",
          "# 输出格式",
          "仅输出 Markdown 正文，不要额外解释。",
        ];
      case "claude-skill":
      default:
        return [
          "输出目标：Claude skill。",
          "请生成可用于 Claude skills 的文档。",
          "当分析模式为 claude-skill 时，忽略其他结构建议，必须严格使用以下固定格式：",
          "# System Prompt",
          "",
          "# 行为原则",
          "",
          "# 推理流程",
          "",
          "# 示例（可选）",
          "仅输出 skill.md 正文，不要额外解释。",
        ];
    }
  })();

  await upsertPendingSkillAnalysis({
    headers: input.headers,
    sourceFileName: input.sourceFileName ?? null,
    questionId: input.questionId,
    questionText: input.questionText ?? null,
    analysisMode,
    providerId: provider.id,
    modelId,
    rawAnswers: input.rawAnswers,
    userInput,
  });

  try {
    await mkdir(OUTPUTS_ROOT, { recursive: true });
    await writeFile(
      path.join(OUTPUTS_ROOT, "experience.json"),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          analysisMode,
          provider: provider.id,
          model: modelId,
          sourceFileName: input.sourceFileName ?? null,
          questionId: input.questionId,
          questionText: input.questionText ?? null,
          userInput,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await generateText({
      model: createModel(provider.id, modelId),
      system: [
        "你是一个专业 AI Skill Builder。",
        "你的任务是：",
        "将用户职业经验转换为 AI Skill Markdown 文件。",
        "",
        "Skill 目标：",
        "让 AI 能够模仿该职业专家回答问题。",
        "",
        "生成要求：",
        "1. 提炼经验，不要逐字复述",
        "2. 合理补充结构",
        "3. 保持专业风格",
        "4. 适合 AI 调用",
        "",
        "生成结构：",
        "---",
        "name:",
        "description:",
        "version: 1.0",
        "------------",
        "# 专家角色",
        "总结用户职业身份",
        "# 核心能力",
        "列出 3-6 个能力",
        "# 决策流程",
        "总结用户工作流程",
        "# 经验规则",
        "总结经验原则",
        "# 典型问题",
        "列出常见问题",
        "# 行为风格",
        "总结沟通风格",
        "# 使用场景",
        "说明 skill 何时调用",
        "",
        `分析模式: ${analysisMode}`,
        ...modeInstructions,
        "",
        "用户输入：",
        "{{user_input}}",
        "",
        "生成最终文档",
        "",
        "输出要求补充：",
        "- 仅输出 skill.md 正文，不要额外解释。",
        "- 使用中文。",
        "- 将用户输入整体视为一次完整上下文进行整理。",
        `- 控制输出长度，避免超出上下文窗口。用户输入已被截断到约 ${MAX_USER_INPUT_CHARS} 字符。`,
        `Current provider: ${provider.name}`,
        `Current model: ${modelId}`,
        input.sourceFileName
          ? `The source question file is ${input.sourceFileName}.`
          : "",
        input.questionText
          ? `The selected source question is: ${input.questionText}`
          : "",
        "If input conflicts with selected question context, prioritize the selected question and keep the output consistent.",
      ]
        .filter(Boolean)
        .join("\n"),
      prompt,
      temperature: 0.4,
    });

    const cleanedText = result.text.trim();

    await writeFile(
      path.join(OUTPUTS_ROOT, resolveAnalysisFileName(analysisMode)),
      `${cleanedText}\n`,
      "utf8",
    );

    await completeSkillAnalysis({
      sourceFileName: input.sourceFileName ?? null,
      questionId: input.questionId,
      analysisMode,
      generatedSkill: cleanedText,
    });

    return { text: cleanedText };
  } catch (error) {
    await failSkillAnalysis({
      sourceFileName: input.sourceFileName ?? null,
      questionId: input.questionId,
      analysisMode,
      errorMessage: error instanceof Error ? error.message : "分析失败。",
    }).catch(() => undefined);

    throw error;
  }
}