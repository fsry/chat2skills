import JSZip from "jszip";
import { z } from "zod";

import {
  ensureExportOutputFiles,
  resolveAllExportContents,
  resolveExportContent,
  resolveExportFileName,
  syncEditedSkillsBeforeExport,
} from "@/lib/services/skill-export-service";
import type { SkillContentByMode } from "@/lib/types";

export const runtime = "nodejs";

const exportSchema = z.object({
  analysisMode: z.enum(["openclaw-skill", "claude-skill", "gpt-prompt-skill", "all-skills"]),
  sourceFileName: z.string().nullable().optional(),
  questionId: z.string().nullable().optional(),
  currentSkills: z
    .object({
      "openclaw-skill": z.string().optional(),
      "claude-skill": z.string().optional(),
      "gpt-prompt-skill": z.string().optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  try {
    const payload = exportSchema.parse(await request.json());

    await syncEditedSkillsBeforeExport({
      analysisMode: payload.analysisMode,
      sourceFileName: payload.sourceFileName ?? null,
      questionId: payload.questionId ?? null,
      currentSkills: (payload.currentSkills ?? {}) as SkillContentByMode,
    });

    await ensureExportOutputFiles({
      analysisMode: payload.analysisMode,
      currentSkills: (payload.currentSkills ?? {}) as SkillContentByMode,
    });

    if (payload.analysisMode !== "all-skills") {
      const fileName = resolveExportFileName(payload.analysisMode);
      const markdown = await resolveExportContent({
        analysisMode: payload.analysisMode,
        currentSkills: (payload.currentSkills ?? {}) as SkillContentByMode,
      });

      return new Response(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "x-export-file": fileName,
        },
      });
    }

    const zip = new JSZip();
    const allContents = await resolveAllExportContents(
      (payload.currentSkills ?? {}) as SkillContentByMode,
    );
    const openclaw = allContents["openclaw.md"];
    const claude = allContents["claude.md"];
    const gpt = allContents["gpt.md"];

    zip.file("openclaw.md", `${openclaw.trim()}\n`);
    zip.file("claude.md", `${claude.trim()}\n`);
    zip.file("gpt.md", `${gpt.trim()}\n`);

    const archive = await zip.generateAsync({ type: "uint8array" });
    const fileName = "skills-all.zip";
    const responseBody = new Uint8Array(archive);

    return new Response(responseBody, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "x-export-file": fileName,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "导出文件失败。",
      },
      { status: 500 },
    );
  }
}