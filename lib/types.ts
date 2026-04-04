export type QuestionGroup = {
  id: string;
  title: string;
  prompts: string[];
};

export type QuestionItem = {
  id: string;
  order: number;
  title: string;
  supplement: string;
  prompts: string[];
  groups: QuestionGroup[];
  text: string;
};

export type ImportedFileInfo = {
  fileName: string;
  rawMarkdownPath: string;
  cleanedAnswersPath: string;
  skillsRootPath: string;
  exportZipPath: string;
  importedAt: string;
  baseSlug: string;
};

export type SavedResponse = {
  questionId: string;
  question: string;
  cleanedResponse: string;
  savedAt: string;
  skillName: string;
  skillSlug: string;
  skillFilePath: string;
};

export type RawPromptAnswer = {
  prompt: string;
  answer: string;
};

export type RawAnswerGroup = {
  id: string;
  title: string;
  prompts: RawPromptAnswer[];
};

export type RawQuestionAnswer = {
  questionId: string;
  title: string;
  supplement: string;
  groups: RawAnswerGroup[];
};

export type AppState = {
  importedFile: ImportedFileInfo | null;
  questions: QuestionItem[];
  savedResponses: SavedResponse[];
  lastExportPath: string | null;
};

export type ProviderState = {
  id: "anthropic" | "openai" | "google";
  name: string;
  configured: boolean;
  envKey: string;
  modelEnvKey: string;
};

export type DashboardState = AppState & {
  providerStates: ProviderState[];
  defaultProviderId: "anthropic" | "openai" | "google";
  availableMarkdownFiles: string[];
};