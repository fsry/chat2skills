import { getPrismaClient } from "@/lib/services/prisma";
import type { RawQuestionAnswer, SingleAnalysisMode, SkillContentByMode } from "@/lib/types";

type RequestMetadata = {
  headers: Headers;
};

type UpsertPendingAnalysisInput = RequestMetadata & {
  sourceFileName: string | null;
  questionId: string;
  questionText: string | null;
  analysisMode: SingleAnalysisMode;
  providerId: string;
  modelId: string;
  rawAnswers: RawQuestionAnswer[];
  userInput: string;
};

type CompleteAnalysisInput = {
  sourceFileName: string | null;
  questionId: string;
  analysisMode: SingleAnalysisMode;
  generatedSkill: string;
};

type FailAnalysisInput = {
  sourceFileName: string | null;
  questionId: string;
  analysisMode: SingleAnalysisMode;
  errorMessage: string;
};

type SyncEditedSkillsInput = {
  sourceFileName: string | null;
  questionId: string;
  currentSkills: SkillContentByMode;
};

function normalizeSourceFileName(sourceFileName: string | null) {
  return sourceFileName?.trim() ?? "";
}

function normalizeSkillContent(value: string) {
  return value.trim();
}

function resolveRequestIp(headers: Headers) {
  const xForwardedFor = headers.get("x-forwarded-for");

  if (xForwardedFor) {
    const forwardedIp = xForwardedFor
      .split(",")
      .map((item) => item.trim())
      .find(Boolean);

    if (forwardedIp) {
      return forwardedIp;
    }
  }

  const forwarded = headers.get("forwarded");

  if (forwarded) {
    const match = forwarded.match(/for=(?:"?)(\[[^\]]+\]|[^;,"]+)/i);

    if (match?.[1]) {
      return match[1].replace(/^\[|\]$/g, "");
    }
  }

  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-client-ip") ??
    null
  );
}

export async function upsertPendingSkillAnalysis(input: UpsertPendingAnalysisInput) {
  const prisma = getPrismaClient();
  const sourceFileName = normalizeSourceFileName(input.sourceFileName);

  return prisma.skillAnalysisRecord.upsert({
    where: {
      source_question_analysis_mode: {
        sourceFileName,
        questionId: input.questionId,
        analysisMode: input.analysisMode,
      },
    },
    update: {
      questionText: input.questionText,
      providerId: input.providerId,
      modelId: input.modelId,
      ipAddress: resolveRequestIp(input.headers),
      userAgent: input.headers.get("user-agent"),
      rawAnswers: input.rawAnswers,
      userInput: input.userInput,
      generatedSkill: null,
      status: "processing",
      lastError: null,
    },
    create: {
      sourceFileName,
      questionId: input.questionId,
      questionText: input.questionText,
      analysisMode: input.analysisMode,
      providerId: input.providerId,
      modelId: input.modelId,
      ipAddress: resolveRequestIp(input.headers),
      userAgent: input.headers.get("user-agent"),
      rawAnswers: input.rawAnswers,
      userInput: input.userInput,
      status: "processing",
    },
  });
}

export async function completeSkillAnalysis(input: CompleteAnalysisInput) {
  const prisma = getPrismaClient();
  const sourceFileName = normalizeSourceFileName(input.sourceFileName);

  return prisma.skillAnalysisRecord.update({
    where: {
      source_question_analysis_mode: {
        sourceFileName,
        questionId: input.questionId,
        analysisMode: input.analysisMode,
      },
    },
    data: {
      generatedSkill: normalizeSkillContent(input.generatedSkill),
      status: "completed",
      lastError: null,
    },
  });
}

export async function failSkillAnalysis(input: FailAnalysisInput) {
  const prisma = getPrismaClient();
  const sourceFileName = normalizeSourceFileName(input.sourceFileName);

  return prisma.skillAnalysisRecord.update({
    where: {
      source_question_analysis_mode: {
        sourceFileName,
        questionId: input.questionId,
        analysisMode: input.analysisMode,
      },
    },
    data: {
      status: "failed",
      lastError: input.errorMessage,
    },
  });
}

export async function syncEditedSkillsIfNeeded(input: SyncEditedSkillsInput) {
  const prisma = getPrismaClient();
  const sourceFileName = normalizeSourceFileName(input.sourceFileName);
  let updatedCount = 0;

  for (const [analysisMode, skillContent] of Object.entries(input.currentSkills) as Array<
    [SingleAnalysisMode, string | undefined]
  >) {
    const nextSkill = skillContent ? normalizeSkillContent(skillContent) : "";

    if (!nextSkill) {
      continue;
    }

    const existingRecord = await prisma.skillAnalysisRecord.findUnique({
      where: {
        source_question_analysis_mode: {
          sourceFileName,
          questionId: input.questionId,
          analysisMode,
        },
      },
      select: {
        generatedSkill: true,
      },
    });

    if (!existingRecord) {
      continue;
    }

    if (normalizeSkillContent(existingRecord.generatedSkill ?? "") === nextSkill) {
      continue;
    }

    await prisma.skillAnalysisRecord.update({
      where: {
        source_question_analysis_mode: {
          sourceFileName,
          questionId: input.questionId,
          analysisMode,
        },
      },
      data: {
        generatedSkill: nextSkill,
        status: "completed",
        lastError: null,
      },
    });

    updatedCount += 1;
  }

  return { updatedCount };
}