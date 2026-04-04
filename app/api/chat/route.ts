import { z } from "zod";

import { analyzeSkill } from "@/lib/services/skill-analysis-service";
import type { RawQuestionAnswer } from "@/lib/types";

export const runtime = "nodejs";

const chatRequestSchema = z.object({
  messages: z.array(z.any()).optional(),
  userInput: z.string().optional(),
  questionId: z.string().optional(),
  questionText: z.string().optional(),
  sourceFileName: z.string().nullable().optional(),
  providerId: z.enum(["anthropic", "openai", "google"]).optional(),
  analysisMode: z
    .enum(["openclaw-skill", "claude-skill", "gpt-prompt-skill"])
    .optional(),
  rawAnswers: z.array(
    z.object({
      questionId: z.string().min(1),
      title: z.string(),
      supplement: z.string(),
      groups: z.array(
        z.object({
          id: z.string().min(1),
          title: z.string(),
          prompts: z.array(
            z.object({
              prompt: z.string(),
              answer: z.string(),
            }),
          ),
        }),
      ),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const payload = chatRequestSchema.parse(await request.json());
    const result = await analyzeSkill({
      headers: request.headers,
      messages: payload.messages,
      userInput: payload.userInput,
      questionId: payload.questionId,
      questionText: payload.questionText,
      sourceFileName: payload.sourceFileName ?? null,
      providerId: payload.providerId,
      analysisMode: payload.analysisMode,
      rawAnswers: payload.rawAnswers as RawQuestionAnswer[],
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "对话请求失败。",
      },
      { status: 500 },
    );
  }
}