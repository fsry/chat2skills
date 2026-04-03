import { readFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import { z } from "zod";

export const runtime = "nodejs";

const OUTPUTS_ROOT = path.join(process.cwd(), "storage", "outputs");

const exportSchema = z.object({
  analysisMode: z.enum(["openclaw-skill", "claude-skill", "gpt-prompt-skill", "all-skills"]),
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

export async function POST(request: Request) {
  try {
    const payload = exportSchema.parse(await request.json());

    if (payload.analysisMode !== "all-skills") {
      const fileName = resolveModeFileName(payload.analysisMode);
      const markdown = await readOutputFile(fileName);

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