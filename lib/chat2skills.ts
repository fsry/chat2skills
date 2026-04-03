import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";

import { getStorageRoot } from "@/lib/storage-paths";
import type {
  AppState,
  ImportedFileInfo,
  QuestionGroup,
  QuestionItem,
  SavedResponse,
} from "@/lib/types";

const STORAGE_ROOT = getStorageRoot();
const IMPORTS_ROOT = path.join(STORAGE_ROOT, "imports");
const OUTPUTS_ROOT = path.join(STORAGE_ROOT, "outputs");
const STATE_PATH = path.join(STORAGE_ROOT, "state.json");
const PROJECT_ROOT = process.cwd();
const DEFAULT_QUESTION_FILE = "QUESTION.md";
const DEFAULT_QUESTION_PATH = path.join(PROJECT_ROOT, DEFAULT_QUESTION_FILE);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "node_modules",
  "storage",
]);

const EMPTY_STATE: AppState = {
  importedFile: null,
  questions: [],
  savedResponses: [],
  lastExportPath: null,
};

function toUnixPath(value: string) {
  return value.split(path.sep).join("/");
}

function toRelativePath(absolutePath: string) {
  return toUnixPath(path.relative(PROJECT_ROOT, absolutePath));
}

function resolveWorkspacePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").trim();

  if (!normalized) {
    throw new Error("请选择项目中的 Markdown 文件。");
  }

  const absolutePath = path.resolve(PROJECT_ROOT, normalized);
  const relativeToRoot = path.relative(PROJECT_ROOT, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("只能读取当前项目目录中的 Markdown 文件。");
  }

  return absolutePath;
}

function timestampToken() {
  return new Date().toISOString().replace(/[.:]/g, "-");
}

function slugify(input: string, fallback: string) {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback;
}

function fileStem(fileName: string) {
  return slugify(path.parse(fileName).name, "questions");
}

function normalizeMarkdown(text: string) {
  return text.replace(/\r\n/g, "\n").trim();
}

function extractPromptsFromTextBlock(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+[.)]\s*/.test(line))
    .map((line, index) => {
      const match = line.match(/^(\d+)[.)]\s*(.*)$/);

      if (!match) {
        return "";
      }

      return match[2].trim() || `第 ${index + 1} 项`;
    })
    .filter(Boolean);
}

function dedupeQuestions(questions: string[]) {
  const seen = new Set<string>();

  return questions.filter((question) => {
    const key = question.trim().toLowerCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeQuestionText(input: string) {
  return input
    .replace(/\s+/g, " ")
    .replace(/[：:]$/, "")
    .trim();
}

function createQuestionId(title: string, index: number) {
  const encoded = Buffer.from(title).toString("base64url").slice(0, 24);

  return `q-${encoded || index + 1}`;
}

function createGroupId(questionId: string, index: number) {
  return `${questionId}:group:${index + 1}`;
}

function extractSectionTitle(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^#+\s*/, "")
    .trim();
}

function dedupeSavedResponsesByQuestionId(savedResponses: SavedResponse[]) {
  const latestByQuestionId = new Map<string, SavedResponse>();

  for (const response of savedResponses) {
    latestByQuestionId.set(response.questionId, response);
  }

  return [...latestByQuestionId.values()];
}

async function syncQuestionsFromDefaultQuestionFile(state: AppState) {
  try {
    const markdown = await readFile(DEFAULT_QUESTION_PATH, "utf8");
    const questions = parseMarkdownQuestions(markdown);

    if (questions.length === 0) {
      return state;
    }

    const questionByTitle = new Map(questions.map((question) => [question.title, question]));
    const syncedSavedResponses = dedupeSavedResponsesByQuestionId(
      state.savedResponses
        .map((response) => {
          const sectionTitle = extractSectionTitle(response.question);
          const matchingQuestion = sectionTitle ? questionByTitle.get(sectionTitle) : null;

          if (!matchingQuestion) {
            return null;
          }

          return {
            ...response,
            questionId: matchingQuestion.id,
            question: matchingQuestion.text,
          };
        })
        .filter((response): response is SavedResponse => Boolean(response)),
    );

    return {
      ...state,
      questions,
      savedResponses: syncedSavedResponses,
    };
  } catch {
    return state;
  }
}

export function parseMarkdownQuestions(markdown: string): QuestionItem[] {
  const normalized = normalizeMarkdown(markdown);

  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const sections: Array<{
    title: string;
    supplementLines: string[];
    prompts: string[];
    groups: Array<{ title: string; prompts: string[] }>;
  }> = [];
  let currentSection:
    | {
        title: string;
        supplementLines: string[];
        prompts: string[];
        groups: Array<{ title: string; prompts: string[] }>;
      }
    | null = null;
  let pendingNumbered: { number: number; text: string; prompts: string[] } | null = null;

  function flushPendingNumbered() {
    if (!currentSection || !pendingNumbered) {
      return;
    }

    const fallbackText = `第 ${pendingNumbered.number} 项`;
    const normalizedText = pendingNumbered.text || fallbackText;

    if (pendingNumbered.prompts.length > 0) {
      currentSection.groups.push({
        title: `${pendingNumbered.number}. ${normalizedText}`,
        prompts: [...pendingNumbered.prompts],
      });
    } else {
      currentSection.prompts.push(normalizedText);
    }

    pendingNumbered = null;
  }

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine || /^---+$/.test(trimmedLine)) {
      continue;
    }

    const headingMatch = trimmedLine.match(/^#\s+(.+)$/);

    if (headingMatch) {
      flushPendingNumbered();

      const headingTitle = normalizeQuestionText(headingMatch[1]);

      currentSection = {
        title: headingTitle,
        supplementLines: [],
        prompts: [],
        groups: [],
      };
      sections.push(currentSection);
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const numberedMatch = trimmedLine.match(/^(\d+)[.)]\s*(.*)$/);
    if (numberedMatch) {
      flushPendingNumbered();

      const promptNumber = Number(numberedMatch[1]);
      const promptText = normalizeQuestionText(numberedMatch[2]);

      pendingNumbered = {
        number: promptNumber,
        text: promptText,
        prompts: [],
      };
      continue;
    }

    const bulletMatch = trimmedLine.match(/^[-*+]\s+(.+)$/);
    if (bulletMatch) {
      const bulletText = normalizeQuestionText(bulletMatch[1]);

      if (!bulletText) {
        continue;
      }

      if (pendingNumbered) {
        pendingNumbered.prompts.push(bulletText);
      } else {
        currentSection.prompts.push(bulletText);
      }
      continue;
    }

    flushPendingNumbered();

    const subHeadingMatch = trimmedLine.match(/^##+\s+(.+)$/);
    if (subHeadingMatch) {
      currentSection.supplementLines.push(normalizeQuestionText(subHeadingMatch[1]));
      continue;
    }

    currentSection.supplementLines.push(trimmedLine);
  }

  flushPendingNumbered();

  return sections.map((section, index) => {
    const prompts = dedupeQuestions(section.prompts);
    const questionId = createQuestionId(section.title, index);
    const groups: QuestionGroup[] = section.groups
      .map((group, groupIndex) => ({
        id: createGroupId(questionId, groupIndex),
        title: group.title,
        prompts: dedupeQuestions(group.prompts),
      }))
      .filter((group) => group.prompts.length > 0);
    const supplement = section.supplementLines.join("\n").trim();

    return {
      id: questionId,
      order: index + 1,
      title: section.title,
      supplement,
      prompts,
      groups,
      text: [
        section.title,
        supplement ? `\n${supplement}` : "",
        groups.length > 0
          ? `\n${groups
              .map((group) => `${group.title}\n${group.prompts.map((prompt) => `- ${prompt}`).join("\n")}`)
              .join("\n\n")}`
          : "",
        prompts.length > 0
          ? `\n${prompts.map((prompt, promptIndex) => `${promptIndex + 1}. ${prompt}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  });
}

export function sanitizeAssistantResponse(response: string) {
  return normalizeMarkdown(response)
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderCleanedAnswersFile(state: AppState) {
  const title = state.importedFile?.fileName ?? "questions.md";
  const header = [
    "# Cleaned Answers",
    "",
    `Source file: ${title}`,
    `Updated at: ${new Date().toISOString()}`,
    "",
  ];

  if (state.savedResponses.length === 0) {
    return [...header, "No cleaned responses saved yet.", ""].join("\n");
  }

  const sections = state.questions
    .map((question) =>
      state.savedResponses.find((response) => response.questionId === question.id),
    )
    .filter((response): response is SavedResponse => Boolean(response))
    .map((response, index) => {
      return [
        `## ${index + 1}. ${response.question}`,
        "",
        `Saved at: ${response.savedAt}`,
        `Skill slug: ${response.skillSlug}`,
        "",
        response.cleanedResponse,
        "",
      ].join("\n");
    });

  return [...header, ...sections].join("\n");
}

function renderSkillMarkdown(savedResponse: SavedResponse) {
  return [
    `# ${savedResponse.skillName}`,
    "",
    "## Use this skill when",
    `- You need to answer or adapt the question: ${savedResponse.question}`,
    "- You want a concise answer seed that has already been cleaned for reuse.",
    "",
    "## Workflow",
    "1. Read the source question and confirm it matches the current user task.",
    "2. Start from the curated answer below instead of drafting from scratch.",
    "3. Keep the final reply consistent with the user context and requested format.",
    "",
    "## Source Question",
    savedResponse.question,
    "",
    "## Curated Answer",
    savedResponse.cleanedResponse,
    "",
  ].join("\n");
}

async function ensureStorage() {
  await mkdir(IMPORTS_ROOT, { recursive: true });
  await mkdir(OUTPUTS_ROOT, { recursive: true });
}

async function walkMarkdownFiles(currentDirectory: string, results: string[]) {
  const entries = await readdir(currentDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await walkMarkdownFiles(path.join(currentDirectory, entry.name), results);
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }

    results.push(toRelativePath(path.join(currentDirectory, entry.name)));
  }
}

async function writeState(state: AppState) {
  await ensureStorage();
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function writeArtifacts(state: AppState) {
  if (!state.importedFile) {
    return;
  }

  const cleanedAbsolutePath = path.join(process.cwd(), state.importedFile.cleanedAnswersPath);
  const skillsRootAbsolutePath = path.join(process.cwd(), state.importedFile.skillsRootPath);

  await mkdir(path.dirname(cleanedAbsolutePath), { recursive: true });
  await mkdir(skillsRootAbsolutePath, { recursive: true });
  await writeFile(cleanedAbsolutePath, renderCleanedAnswersFile(state), "utf8");

  const manifest = state.savedResponses.map((response) => ({
    questionId: response.questionId,
    question: response.question,
    skillName: response.skillName,
    skillSlug: response.skillSlug,
    skillFilePath: response.skillFilePath,
  }));

  await Promise.all(
    state.savedResponses.map(async (response) => {
      const skillFileAbsolutePath = path.join(process.cwd(), response.skillFilePath);
      await mkdir(path.dirname(skillFileAbsolutePath), { recursive: true });
      await writeFile(skillFileAbsolutePath, renderSkillMarkdown(response), "utf8");
    }),
  );

  await writeFile(
    path.join(skillsRootAbsolutePath, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

export async function readState(): Promise<AppState> {
  try {
    const content = await readFile(STATE_PATH, "utf8");
    const parsed = { ...EMPTY_STATE, ...JSON.parse(content) } as AppState;

    const normalizedState: AppState = {
      ...parsed,
      questions: parsed.questions.map((question) => ({
        ...question,
        title: question.title || `问题 ${question.order}`,
        supplement: question.supplement || "",
        prompts:
          Array.isArray(question.prompts) && question.prompts.length > 0
            ? question.prompts
            : extractPromptsFromTextBlock(question.text),
        groups:
          Array.isArray(question.groups) && question.groups.length > 0
            ? question.groups
            : [
                {
                  id: createGroupId(question.id, 0),
                  title: "问题组 1",
                  prompts:
                    Array.isArray(question.prompts) && question.prompts.length > 0
                      ? question.prompts
                      : extractPromptsFromTextBlock(question.text),
                },
              ].filter((group) => group.prompts.length > 0),
      })),
    };

    return syncQuestionsFromDefaultQuestionFile(normalizedState);
  } catch {
    return syncQuestionsFromDefaultQuestionFile(EMPTY_STATE);
  }
}

export async function listProjectMarkdownFiles() {
  const markdownFiles: string[] = [];

  await walkMarkdownFiles(PROJECT_ROOT, markdownFiles);

  return markdownFiles.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export async function importQuestionsMarkdown(fileName: string, markdown: string) {
  await ensureStorage();

  const questions = parseMarkdownQuestions(markdown);
  if (questions.length === 0) {
    throw new Error("没有从 Markdown 中解析到可用问题。请使用标题、列表或按空行分隔的问题文本。");
  }

  const stamp = timestampToken();
  const baseSlug = `${fileStem(fileName)}-${stamp}`;
  const rawMarkdownAbsolutePath = path.join(IMPORTS_ROOT, `${baseSlug}.md`);
  const cleanedAnswersAbsolutePath = path.join(OUTPUTS_ROOT, `${baseSlug}-cleaned.md`);
  const skillsRootAbsolutePath = path.join(OUTPUTS_ROOT, `${baseSlug}-skills`, ".claude", "skills");
  const exportZipAbsolutePath = path.join(OUTPUTS_ROOT, `${baseSlug}-skills.zip`);

  await writeFile(rawMarkdownAbsolutePath, `${normalizeMarkdown(markdown)}\n`, "utf8");

  const importedFile: ImportedFileInfo = {
    fileName,
    rawMarkdownPath: toRelativePath(rawMarkdownAbsolutePath),
    cleanedAnswersPath: toRelativePath(cleanedAnswersAbsolutePath),
    skillsRootPath: toRelativePath(skillsRootAbsolutePath),
    exportZipPath: toRelativePath(exportZipAbsolutePath),
    importedAt: new Date().toISOString(),
    baseSlug,
  };

  const nextState: AppState = {
    importedFile,
    questions,
    savedResponses: [],
    lastExportPath: null,
  };

  await writeArtifacts(nextState);
  await writeState(nextState);

  return nextState;
}

export async function importQuestionsFromProject(relativePath: string) {
  const absolutePath = resolveWorkspacePath(relativePath);

  if (!absolutePath.toLowerCase().endsWith(".md")) {
    throw new Error("只支持导入项目中的 .md 文件。");
  }

  const markdown = await readFile(absolutePath, "utf8");

  return importQuestionsMarkdown(toRelativePath(absolutePath), markdown);
}

export async function saveCleanedResponse(questionId: string, response: string) {
  const currentState = await readState();

  if (!currentState.importedFile) {
    throw new Error("请先导入一个 Markdown 问题文件。");
  }

  const question = currentState.questions.find((item) => item.id === questionId);
  if (!question) {
    throw new Error("未找到要保存的问题。");
  }

  const cleanedResponse = sanitizeAssistantResponse(response);
  if (!cleanedResponse) {
    throw new Error("当前回复在清洗后为空，无法保存。");
  }

  const skillSlug = slugify(question.text, `skill-${question.order}`);
  const skillName = `Answer ${question.order}`;
  const skillFilePath = toUnixPath(
    path.join(currentState.importedFile.skillsRootPath, skillSlug, "SKILL.md"),
  );

  const savedResponse: SavedResponse = {
    questionId: question.id,
    question: question.text,
    cleanedResponse,
    savedAt: new Date().toISOString(),
    skillName,
    skillSlug,
    skillFilePath,
  };

  const savedResponses = currentState.savedResponses.filter(
    (item) => item.questionId !== question.id,
  );
  savedResponses.push(savedResponse);

  const nextState: AppState = {
    ...currentState,
    savedResponses,
  };

  await writeArtifacts(nextState);
  await writeState(nextState);

  return nextState;
}

export async function buildClaudeSkillsArchive() {
  const state = await readState();

  if (!state.importedFile) {
    throw new Error("请先导入问题文件，再导出 skills 包。");
  }

  if (state.savedResponses.length === 0) {
    throw new Error("还没有已保存的清洗回复，无法生成 skills 包。");
  }

  await writeArtifacts(state);

  const zip = new JSZip();
  zip.file(
    "README.md",
    [
      "# Claude Skills Pack",
      "",
      `Source: ${state.importedFile.fileName}`,
      `Generated at: ${new Date().toISOString()}`,
      "",
      "Unzip this package at the root of your Claude workspace to merge the .claude/skills directory.",
      "",
    ].join("\n"),
  );
  zip.file(
    ".claude/skills/manifest.json",
    `${JSON.stringify(
      state.savedResponses.map((response) => ({
        questionId: response.questionId,
        skillSlug: response.skillSlug,
        skillName: response.skillName,
      })),
      null,
      2,
    )}\n`,
  );
  zip.file("cleaned-answers.md", renderCleanedAnswersFile(state));

  state.savedResponses.forEach((response) => {
    zip.file(
      `.claude/skills/${response.skillSlug}/SKILL.md`,
      renderSkillMarkdown(response),
    );
  });

  const archive = await zip.generateAsync({ type: "uint8array" });
  const exportAbsolutePath = path.join(process.cwd(), state.importedFile.exportZipPath);

  await mkdir(path.dirname(exportAbsolutePath), { recursive: true });
  await writeFile(exportAbsolutePath, archive);

  const nextState: AppState = {
    ...state,
    lastExportPath: state.importedFile.exportZipPath,
  };

  await writeState(nextState);

  return {
    archive,
    fileName: `${state.importedFile.baseSlug}-claude-skills.zip`,
    exportZipPath: state.importedFile.exportZipPath,
  };
}