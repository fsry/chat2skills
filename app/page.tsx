import { Chat2SkillsDashboard } from "@/components/chat2skills-dashboard";
import { AI_PROVIDERS, getDefaultProviderId } from "@/lib/ai-providers";
import { listProjectMarkdownFiles, readState } from "@/lib/chat2skills";
import type { DashboardState } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const state = await readState();
  const availableMarkdownFiles = await listProjectMarkdownFiles();

  const dashboardState: DashboardState = {
    ...state,
    providerStates: AI_PROVIDERS.map((provider) => ({
      ...provider,
      configured: Boolean(process.env[provider.envKey]),
    })),
    defaultProviderId: getDefaultProviderId(),
    availableMarkdownFiles,
  };

  return <Chat2SkillsDashboard initialState={dashboardState} />;
}
