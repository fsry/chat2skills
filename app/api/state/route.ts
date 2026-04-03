import { NextResponse } from "next/server";

import { AI_PROVIDERS, getDefaultProviderId } from "@/lib/ai-providers";
import { listProjectMarkdownFiles, readState } from "@/lib/chat2skills";

export const runtime = "nodejs";

export async function GET() {
  const state = await readState();
  const availableMarkdownFiles = await listProjectMarkdownFiles();

  return NextResponse.json({
    ...state,
    providerStates: AI_PROVIDERS.map((provider) => ({
      ...provider,
      configured: Boolean(process.env[provider.envKey]),
    })),
    defaultProviderId: getDefaultProviderId(),
    availableMarkdownFiles,
  });
}