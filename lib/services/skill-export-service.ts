import { readFile } from "node:fs/promises";
import path from "node:path";

import { syncEditedSkillsIfNeeded } from "@/lib/services/skill-analysis-record-service";
import { getOutputsRoot } from "@/lib/storage-paths";
import type { AnalysisMode, SingleAnalysisMode, SkillContentByMode } from "@/lib/types";

const OUTPUTS_ROOT = getOutputsRoot();

function resolveModeFileName(mode: SingleAnalysisMode) {
  switch (mode) {
    case "openclaw-skill":
      return "openclaw.md";
    case "gpt-prompt-skill":
      return "gpt.md";
    case "claude-skill":
    default:
      return "claude.md";
  }
}

export async function readExportOutputFile(fileName: string) {
  try {
    return await readFile(path.join(OUTPUTS_ROOT, fileName), "utf8");
  } catch {
    throw new Error(`未找到 ${fileName}，请先执行对应类型的解析后再导出。`);
  }
}

export function resolveExportFileName(mode: SingleAnalysisMode) {
  return resolveModeFileName(mode);
}

export async function syncEditedSkillsBeforeExport(input: {
  analysisMode: AnalysisMode;
  sourceFileName: string | null;
  questionId: string | null;
  currentSkills: SkillContentByMode;
}) {
  if (!input.questionId) {
    return { updatedCount: 0 };
  }

  return syncEditedSkillsIfNeeded({
    sourceFileName: input.sourceFileName,
    questionId: input.questionId,
    currentSkills:
      input.analysisMode === "all-skills"
        ? input.currentSkills
        : Object.fromEntries(
            Object.entries(input.currentSkills).filter(([mode]) => mode === input.analysisMode),
          ),
  });
}