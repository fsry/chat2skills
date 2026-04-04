import { mkdir, readFile, writeFile } from "node:fs/promises";
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

async function writeExportOutputFile(fileName: string, content: string) {
  await mkdir(OUTPUTS_ROOT, { recursive: true });
  await writeFile(path.join(OUTPUTS_ROOT, fileName), `${content.trim()}\n`, "utf8");
}

export function resolveExportFileName(mode: SingleAnalysisMode) {
  return resolveModeFileName(mode);
}

export async function ensureExportOutputFiles(input: {
  analysisMode: AnalysisMode;
  currentSkills: SkillContentByMode;
}) {
  if (input.analysisMode === "all-skills") {
    await Promise.all(
      (Object.entries(input.currentSkills) as Array<[SingleAnalysisMode, string | undefined]>).flatMap(
        ([mode, content]) => {
          const normalizedContent = content?.trim();

          if (!normalizedContent) {
            return [];
          }

          return [writeExportOutputFile(resolveModeFileName(mode), normalizedContent)];
        },
      ),
    );

    return;
  }

  const singleModeContent = input.currentSkills[input.analysisMode]?.trim();

  if (!singleModeContent) {
    return;
  }

  await writeExportOutputFile(resolveModeFileName(input.analysisMode), singleModeContent);
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