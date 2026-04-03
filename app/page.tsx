import { Chat2SkillsDashboard } from "@/components/chat2skills-dashboard";
import { AI_PROVIDERS, getDefaultProviderId } from "@/lib/ai-providers";
import {
  importQuestionsFromProject,
  listProjectMarkdownFiles,
  readState,
} from "@/lib/chat2skills";
import type { DashboardState } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT_QUESTION_FILE = "QUESTION.md";

export default async function Home() {
  const state = await readState();
  const availableMarkdownFiles = await listProjectMarkdownFiles();
  const shouldBootstrapFromQuestionFile =
    !state.importedFile &&
    availableMarkdownFiles.includes(DEFAULT_QUESTION_FILE);

  const runtimeState = shouldBootstrapFromQuestionFile
    ? await importQuestionsFromProject(DEFAULT_QUESTION_FILE)
    : state;

  const dashboardState: DashboardState = {
    ...runtimeState,
    providerStates: AI_PROVIDERS.map((provider) => ({
      ...provider,
      configured: Boolean(process.env[provider.envKey]),
    })),
    defaultProviderId: getDefaultProviderId(),
    availableMarkdownFiles,
  };

  return <Chat2SkillsDashboard initialState={dashboardState} />;
}
