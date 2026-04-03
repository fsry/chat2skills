import { NextResponse } from "next/server";
import { z } from "zod";

import { saveCleanedResponse } from "@/lib/chat2skills";

export const runtime = "nodejs";

const saveSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const payload = saveSchema.parse(await request.json());
    const nextState = await saveCleanedResponse(payload.questionId, payload.answer);
    const savedItem = nextState.savedResponses.find(
      (item) => item.questionId === payload.questionId,
    );

    return NextResponse.json({
      ok: true,
      skillSlug: savedItem?.skillSlug ?? null,
      cleanedAnswersPath: nextState.importedFile?.cleanedAnswersPath ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "保存回答失败。",
      },
      { status: 500 },
    );
  }
}