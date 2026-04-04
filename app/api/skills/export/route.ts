import { readFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import { z } from "zod";

import { logExportDownload } from "@/lib/download-logs";
import { getOutputsRoot } from "@/lib/storage-paths";
import type { RawQuestionAnswer } from "@/lib/types";

export const runtime = "nodejs";

const OUTPUTS_ROOT = getOutputsRoot();

const exportSchema = z.object({
  analysisMode: z.enum(["openclaw-skill", "claude-skill", "gpt-prompt-skill", "all-skills"]),
  sourceFileName: z.string().nullable().optional(),
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

function resolveModeFileName(mode: "openclaw-skill" | "claude-skill" | "gpt-prompt-skill") {
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

async function readOutputFile(fileName: string) {
  try {
    return await readFile(path.join(OUTPUTS_ROOT, fileName), "utf8");
  } catch {
    throw new Error(`未找到 ${fileName}，请先执行对应类型的解析后再导出。`);
  }
}

function getRequestIp(request: Request) {
  const xForwardedFor = request.headers.get("x-forwarded-for");

  if (xForwardedFor) {
    const forwardedIp = xForwardedFor
      .split(",")
      .map((item) => item.trim())
      .find(Boolean);

    if (forwardedIp) {
      return forwardedIp;
    }
  }

  const forwarded = request.headers.get("forwarded");

  if (forwarded) {
    const match = forwarded.match(/for=(?:"?)(\[[^\]]+\]|[^;,"]+)/i);

    if (match?.[1]) {
      return match[1].replace(/^\[|\]$/g, "");
    }
  }

  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-client-ip") ??
    null
  );
}

async function persistDownloadLog(options: {
  request: Request;
  analysisMode: "openclaw-skill" | "claude-skill" | "gpt-prompt-skill" | "all-skills";
  sourceFileName: string | null;
  rawAnswers: RawQuestionAnswer[];
  exportedFileName: string;
  generatedSkills: Record<string, string>;
}) {
  await logExportDownload({
    analysisMode: options.analysisMode,
    exportedFileName: options.exportedFileName,
    sourceFileName: options.sourceFileName,
    ipAddress: getRequestIp(options.request),
    userAgent: options.request.headers.get("user-agent"),
    rawAnswers: options.rawAnswers,
    generatedSkills: options.generatedSkills,
  });
}

export async function POST(request: Request) {
  try {
    const payload = exportSchema.parse(await request.json());

    if (payload.analysisMode !== "all-skills") {
      const fileName = resolveModeFileName(payload.analysisMode);
      const markdown = await readOutputFile(fileName);

      await persistDownloadLog({
        request,
        analysisMode: payload.analysisMode,
        sourceFileName: payload.sourceFileName ?? null,
        rawAnswers: payload.rawAnswers,
        exportedFileName: fileName,
        generatedSkills: {
          [fileName]: markdown,
        },
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
    const openclaw = await readOutputFile("openclaw.md");
    const claude = await readOutputFile("claude.md");
    const gpt = await readOutputFile("gpt.md");

    await persistDownloadLog({
      request,
      analysisMode: payload.analysisMode,
      sourceFileName: payload.sourceFileName ?? null,
      rawAnswers: payload.rawAnswers,
      exportedFileName: "skills-all.zip",
      generatedSkills: {
        "openclaw.md": openclaw,
        "claude.md": claude,
        "gpt.md": gpt,
      },
    });

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