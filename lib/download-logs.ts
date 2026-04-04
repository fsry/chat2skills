import { prisma } from "@/lib/prisma";
import type { RawQuestionAnswer } from "@/lib/types";

type LogDownloadInput = {
  analysisMode: "openclaw-skill" | "claude-skill" | "gpt-prompt-skill" | "all-skills";
  exportedFileName: string;
  sourceFileName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  rawAnswers: RawQuestionAnswer[];
  generatedSkills: Record<string, string>;
};

export async function logExportDownload(input: LogDownloadInput) {
  return prisma.exportDownloadLog.create({
    data: {
      analysisMode: input.analysisMode,
      exportedFileName: input.exportedFileName,
      sourceFileName: input.sourceFileName,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      rawAnswers: input.rawAnswers,
      generatedSkills: input.generatedSkills,
    },
  });
}