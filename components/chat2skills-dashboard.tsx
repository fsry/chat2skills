"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Download, LoaderCircle, Save, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { DashboardState, RawQuestionAnswer, SingleAnalysisMode, SkillContentByMode } from "@/lib/types";

type Props = {
  initialState: DashboardState;
};

const ANSWERS_DRAFT_STORAGE_KEY = "chat2skills.answers.draft.v1";
const ANALYSIS_RESULTS_STORAGE_KEY = "chat2skills.analysis.results.v1";
const SUBMIT_DEBOUNCE_MS = 800;

const ANALYSIS_MODES = [
  { id: "openclaw-skill", label: "OpenClaw skill" },
  { id: "claude-skill", label: "Claude skill" },
  { id: "gpt-prompt-skill", label: "GPT prompt skill" },
] as const;

type AnalysisModeId = (typeof ANALYSIS_MODES)[number]["id"];
type AnalysisSelectionId = AnalysisModeId | "all-skills";
type StoredAnalysisResult = {
  content: string;
  analyzedAt: string;
};

/** Strip Chinese numeral prefixes like "一、" "二、" from titles */
function stripTitleNumber(title: string) {
  return title.replace(/^[一二三四五六七八九十]+、\s*/, "");
}

function getQuestionGroups(question: DashboardState["questions"][number]) {
  if (Array.isArray(question.groups) && question.groups.length > 0) {
    return question.groups;
  }

  if (Array.isArray(question.prompts) && question.prompts.length > 0) {
    return [
      {
        id: `${question.id}:group:fallback`,
        title: "",
        prompts: question.prompts,
      },
    ];
  }

  return [];
}

function isMobileBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

export function Chat2SkillsDashboard({ initialState }: Props) {
  const [dashboardState, setDashboardState] = useState(initialState);
  const selectedProviderId = initialState.defaultProviderId;
  const [selectedQuestionId, setSelectedQuestionId] = useState(
    initialState.questions[0]?.id ?? "",
  );
  const [answersByPrompt, setAnswersByPrompt] = useState<Record<string, string>>({});
  const [invalidPromptKeys, setInvalidPromptKeys] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [organizedResult, setOrganizedResult] = useState("");
  const [analysisResultsByMode, setAnalysisResultsByMode] = useState<
    Record<string, StoredAnalysisResult>
  >({});
  const [analysisSelection, setAnalysisSelection] = useState<AnalysisSelectionId>("claude-skill");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();
  const [isExporting, startExportTransition] = useTransition();
  const lastSubmitAtRef = useRef(0);
  const promptRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const selectedQuestion = dashboardState.questions.find(
    (question) => question.id === selectedQuestionId,
  );
  const savedResponse = dashboardState.savedResponses.find(
    (item) => item.questionId === selectedQuestionId,
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ANSWERS_DRAFT_STORAGE_KEY);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as { answersByPrompt?: Record<string, string> };
      if (parsed.answersByPrompt && typeof parsed.answersByPrompt === "object") {
        setAnswersByPrompt(parsed.answersByPrompt);
      }
    } catch {
      // Ignore malformed local draft data.
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ANALYSIS_RESULTS_STORAGE_KEY);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Record<
        string,
        string | { content?: string; analyzedAt?: string }
      >;
      const normalizedEntries = Object.entries(parsed).flatMap(([key, value]) => {
        if (typeof value === "string") {
          return [[key, { content: value, analyzedAt: new Date(0).toISOString() }] as const];
        }

        if (value && typeof value.content === "string") {
          return [
            [
              key,
              {
                content: value.content,
                analyzedAt: value.analyzedAt ?? new Date(0).toISOString(),
              },
            ] as const,
          ];
        }

        return [];
      });

      setAnalysisResultsByMode(Object.fromEntries(normalizedEntries));
    } catch {
      // Ignore malformed local analysis cache data.
    }
  }, []);

  useEffect(() => {
    const selectedQuestionStillExists = dashboardState.questions.some(
      (question) => question.id === selectedQuestionId,
    );

    if ((!selectedQuestionId || !selectedQuestionStillExists) && dashboardState.questions.length > 0) {
      setSelectedQuestionId(dashboardState.questions[0].id);
    }
  }, [dashboardState.questions, selectedQuestionId]);

  useEffect(() => {
    setInvalidPromptKeys([]);
  }, [selectedQuestionId]);

  useEffect(() => {
    if (!selectedQuestion) {
      setOrganizedResult("");
      return;
    }

    const cachedResult = resolveDisplayedAnalysisResult(
      selectedQuestion.id,
      analysisSelection,
      savedResponse?.cleanedResponse ?? "",
      savedResponse?.savedAt,
    );

    setOrganizedResult(cachedResult);
  }, [
    analysisResultsByMode,
    analysisSelection,
    savedResponse?.cleanedResponse,
    savedResponse?.savedAt,
    selectedQuestion?.id,
  ]);

  const latestAssistantText = organizedResult.trim();

  function promptKey(groupIndex: number, promptIndex: number, questionId = selectedQuestionId) {
    return `${questionId}:${groupIndex}:${promptIndex}`;
  }

  function analysisResultKey(questionId: string, mode: AnalysisModeId) {
    return `${questionId}:${mode}`;
  }

  function persistAnalysisResultsToLocalStorage(nextResults: Record<string, StoredAnalysisResult>) {
    try {
      window.localStorage.setItem(ANALYSIS_RESULTS_STORAGE_KEY, JSON.stringify(nextResults));
    } catch {
      // Ignore local analysis cache failures.
    }
  }

  function getAnswer(groupIndex: number, promptIndex: number) {
    return answersByPrompt[promptKey(groupIndex, promptIndex)] ?? "";
  }

  function setAnswer(groupIndex: number, promptIndex: number, value: string) {
    const key = promptKey(groupIndex, promptIndex);

    setAnswersByPrompt((current) => ({
      ...current,
      [key]: value,
    }));

    if (value.trim()) {
      setInvalidPromptKeys((current) => current.filter((item) => item !== key));
    }
  }

  function setPromptRef(key: string, element: HTMLTextAreaElement | null) {
    if (element) {
      promptRefs.current[key] = element;
      return;
    }

    delete promptRefs.current[key];
  }

  function focusPrompt(key: string) {
    const element = promptRefs.current[key];

    if (!element) {
      return;
    }

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      element.focus({ preventScroll: true });
    }, 150);
  }

  function validateCurrentQuestionAnswers() {
    if (!selectedQuestion) {
      return false;
    }

    const emptyKeys = getQuestionGroups(selectedQuestion).flatMap((group, groupIndex) =>
      group.prompts.flatMap((_, promptIndex) => {
        const key = promptKey(groupIndex, promptIndex);

        return getAnswer(groupIndex, promptIndex).trim() ? [] : [key];
      }),
    );

    setInvalidPromptKeys(emptyKeys);

    if (emptyKeys.length > 0) {
      setStatusMessage("请先完成当前章节的所有回答，再进行分析。");
      focusPrompt(emptyKeys[0]);
      return false;
    }

    return true;
  }

  function buildSectionInput() {
    if (!selectedQuestion) {
      return "";
    }

    const groups = getQuestionGroups(selectedQuestion);

    const promptBlocks = groups.flatMap((group, groupIndex) =>
      group.prompts.map((prompt, promptIndex) => {
        const answer = getAnswer(groupIndex, promptIndex).trim();

        return [
          group.title ? `分组: ${group.title}` : "",
          `问题 ${promptIndex + 1}: ${prompt}`,
          `用户回答: ${answer || "（未填写）"}`,
        ].join("\n");
      }),
    );

    return [
      `请整理以下章节问卷回答：${selectedQuestion.title}`,
      selectedQuestion.supplement ? `章节补充内容：\n${selectedQuestion.supplement}` : "",
      "",
      ...promptBlocks,
      "",
      "请输出结构化 markdown，总结核心经验，保留用户原意。",
    ].join("\n");
  }

  function buildRawAnswersPayload(): RawQuestionAnswer[] {
    return dashboardState.questions
      .map((question) => {
        const groups = getQuestionGroups(question)
          .map((group, groupIndex) => ({
            id: group.id,
            title: group.title,
            prompts: group.prompts.map((prompt, promptIndex) => ({
              prompt,
              answer: answersByPrompt[promptKey(groupIndex, promptIndex, question.id)] ?? "",
            })),
          }))
          .filter((group) => group.prompts.some((prompt) => prompt.answer.trim()));

        return {
          questionId: question.id,
          title: question.title,
          supplement: question.supplement,
          groups,
        };
      })
      .filter((question) => question.groups.length > 0);
  }

  function setAnalysisResultForMode(questionId: string, mode: AnalysisModeId, value: string) {
    const analyzedAt = new Date().toISOString();

    setAnalysisResultsByMode((current) => {
      const nextResults = {
        ...current,
        [analysisResultKey(questionId, mode)]: {
          content: value,
          analyzedAt,
        },
      };

      persistAnalysisResultsToLocalStorage(nextResults);
      return nextResults;
    });
  }

  function getAnalysisResultForMode(questionId: string, mode: AnalysisModeId) {
    return analysisResultsByMode[analysisResultKey(questionId, mode)]?.content ?? "";
  }

  function getAnalysisResultEntry(questionId: string, mode: AnalysisModeId) {
    return analysisResultsByMode[analysisResultKey(questionId, mode)] ?? null;
  }

  function parseCombinedSkillsResult(value: string) {
    const trimmed = value.trim();

    if (!trimmed) {
      return {} as SkillContentByMode;
    }

    const markers = ANALYSIS_MODES.map((mode) => ({
      id: mode.id,
      marker: `# ${mode.label}`,
    }));

    const positions = markers
      .map((item) => ({
        ...item,
        index: trimmed.indexOf(item.marker),
      }))
      .filter((item) => item.index >= 0)
      .sort((left, right) => left.index - right.index);

    if (positions.length === 0) {
      return {} as SkillContentByMode;
    }

    const result: SkillContentByMode = {};

    positions.forEach((currentItem, index) => {
      const sectionStart = currentItem.index + currentItem.marker.length;
      const sectionEnd = positions[index + 1]?.index ?? trimmed.length;
      const content = trimmed.slice(sectionStart, sectionEnd).replace(/^\s+/, "").replace(/\n\s*---\s*$/, "").trim();

      if (content) {
        result[currentItem.id] = content;
      }
    });

    return result;
  }

  function buildCurrentSkillsPayload(): SkillContentByMode {
    if (!selectedQuestion) {
      return {};
    }

    if (analysisSelection !== "all-skills") {
      return organizedResult.trim()
        ? { [analysisSelection]: organizedResult.trim() }
        : {};
    }

    const parsedResult = parseCombinedSkillsResult(organizedResult);
    const fallbackResult = ANALYSIS_MODES.reduce<SkillContentByMode>((accumulator, mode) => {
      const existing = getAnalysisResultForMode(selectedQuestion.id, mode.id).trim();

      if (existing) {
        accumulator[mode.id] = existing;
      }

      return accumulator;
    }, {});

    return {
      ...fallbackResult,
      ...parsedResult,
    };
  }

  function buildCombinedAnalysisResult(questionId: string) {
    const sections = ANALYSIS_MODES.flatMap((mode) => {
      const content = getAnalysisResultForMode(questionId, mode.id).trim();

      if (!content) {
        return [];
      }

      return [`# ${mode.label}\n\n${content}`];
    });

    return sections.join("\n\n---\n\n");
  }

  function resolveDisplayedAnalysisResult(
    questionId: string,
    selection: AnalysisSelectionId,
    savedContent: string,
    savedAt?: string,
  ) {
    if (selection === "all-skills") {
      const combinedCachedResult = buildCombinedAnalysisResult(questionId);

      return combinedCachedResult || savedContent;
    }

    const cachedResult = getAnalysisResultEntry(questionId, selection);

    if (!cachedResult) {
      return savedContent;
    }

    if (!savedAt) {
      return cachedResult.content;
    }

    return new Date(cachedResult.analyzedAt).getTime() >= new Date(savedAt).getTime()
      ? cachedResult.content
      : savedContent;
  }

  function persistDraftToLocalStorage() {
    try {
      const draft = {
        answersByPrompt,
        updatedAt: new Date().toISOString(),
      };

      window.localStorage.setItem(ANSWERS_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      return true;
    } catch {
      return false;
    }
  }

  async function deliverExportFile(blob: Blob, fileName: string) {
    const file = new File([blob], fileName, {
      type: blob.type || "application/octet-stream",
    });
    const canShareFiles =
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] });

    if (canShareFiles) {
      await navigator.share({
        files: [file],
        title: fileName,
      });

      return "shared" as const;
    }

    const downloadUrl = window.URL.createObjectURL(blob);

    if (isMobileBrowser()) {
      const previewWindow = window.open(downloadUrl, "_blank", "noopener,noreferrer");

      window.setTimeout(() => {
        window.URL.revokeObjectURL(downloadUrl);
      }, 60_000);

      if (previewWindow) {
        return "opened" as const;
      }
    }

    const anchor = document.createElement("a");

    anchor.href = downloadUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(downloadUrl);

    return "downloaded" as const;
  }

  async function refreshState() {
    const response = await fetch("/api/state", { cache: "no-store" });

    if (!response.ok) {
      throw new Error("无法刷新当前状态。");
    }

    const nextState = (await response.json()) as DashboardState;
    setDashboardState(nextState);
  }

  async function handleSend() {
    const now = Date.now();
    if (now - lastSubmitAtRef.current < SUBMIT_DEBOUNCE_MS) {
      setStatusMessage("提交过于频繁，请稍候再试。");
      return;
    }

    if (!selectedQuestion) {
      setStatusMessage("请先从顶部选择一个章节。");
      return;
    }

    if (!validateCurrentQuestionAnswers()) {
      return;
    }

    const hasAnyProviderConfigured = dashboardState.providerStates.some(
      (provider) => provider.configured,
    );

    if (!hasAnyProviderConfigured) {
      setStatusMessage(
        "请至少配置一个模型密钥：ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY。",
      );
      return;
    }

    const text = buildSectionInput().trim();
    if (!text) {
      setStatusMessage("请先填写当前章节下的问题回答。");
      return;
    }

    lastSubmitAtRef.current = now;

    if (analysisSelection === "all-skills") {
      await handleAnalyzeAll();
      return;
    }

    await handleSingleAnalysis(analysisSelection);
  }

  async function requestAnalysis(mode: AnalysisModeId) {
    if (!selectedQuestion) {
      throw new Error("请先从顶部选择一个章节。");
    }

    const text = buildSectionInput().trim();
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userInput: text,
        questionId: selectedQuestionId,
        questionText: selectedQuestion.text,
        sourceFileName: dashboardState.importedFile?.fileName ?? null,
        providerId: selectedProviderId,
        analysisMode: mode,
        rawAnswers: buildRawAnswersPayload(),
      }),
    });

    const payload = (await response.json()) as { text?: string; error?: string };

    if (!response.ok) {
      throw new Error(payload.error ?? "提交失败，请稍后重试。");
    }

    return (payload.text ?? "").trim();
  }

  async function handleSingleAnalysis(mode: AnalysisModeId) {
    setStatusMessage(`正在调用模型（${ANALYSIS_MODES.find((item) => item.id === mode)?.label}），请稍候...`);
    setIsSubmitting(true);

    try {
      const text = await requestAnalysis(mode);
      setOrganizedResult(text);
      if (selectedQuestion) {
        setAnalysisResultForMode(selectedQuestion.id, mode, text);
      }
      setStatusMessage(`整理完成（${ANALYSIS_MODES.find((item) => item.id === mode)?.label}），可继续编辑后再保存或导出。`);
    } catch (sendError) {
      setStatusMessage(sendError instanceof Error ? sendError.message : "提交失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAnalyzeAll() {
    setStatusMessage("正在全部解析：OpenClaw skill -> Claude skill -> GPT prompt skill...");
    setIsSubmitting(true);

    try {
      const sections: string[] = [];

      for (const mode of ANALYSIS_MODES) {
        const text = await requestAnalysis(mode.id);
        if (selectedQuestion) {
          setAnalysisResultForMode(selectedQuestion.id, mode.id, text);
        }
        sections.push(`# ${mode.label}\n\n${text || "（无输出）"}`);
      }

      setOrganizedResult(sections.join("\n\n---\n\n"));
      setStatusMessage("全部解析完成，可继续编辑后再保存或导出。");
    } catch (sendError) {
      setStatusMessage(sendError instanceof Error ? sendError.message : "提交失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function performSave() {
    try {
      if (!selectedQuestion) {
        setStatusMessage("请先从顶部选择一个章节。");
        return;
      }

      const draftSaved = persistDraftToLocalStorage();

      const currentEditedText = organizedResult.trim();
      if (!currentEditedText) {
        setStatusMessage(
          draftSaved
            ? "当前问答已保存到本地浏览器草稿。当前还没有可保存到服务器的整理结果，请先提交并整理。"
            : "当前没有可保存的整理结果，且本地浏览器草稿保存失败，请稍后重试。",
        );
        return;
      }

      const response = await fetch("/api/answers/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          questionId: selectedQuestion.id,
          answer: currentEditedText,
        }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "保存失败，请稍后重试。");
      }

      await refreshState();
      setStatusMessage(
        draftSaved
          ? "已保存整理结果并同步到导出内容，当前问答草稿也已保存到本地浏览器。"
          : "已保存整理结果并同步到导出内容，但本地浏览器草稿保存失败。",
      );
    } catch (saveError) {
      setStatusMessage(saveError instanceof Error ? saveError.message : "保存失败，请稍后重试。");
    }
  }

  async function performExport() {
    try {
      const currentEditedText = organizedResult.trim();

      if (selectedQuestion && currentEditedText) {
        const saveResponse = await fetch("/api/answers/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            questionId: selectedQuestion.id,
            answer: currentEditedText,
          }),
        });

        const savePayload = (await saveResponse.json()) as { error?: string };

        if (!saveResponse.ok) {
          throw new Error(savePayload.error ?? "导出前保存失败。请稍后重试。");
        }
      }

      const response = await fetch("/api/skills/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          analysisMode: analysisSelection,
          questionId: selectedQuestion?.id ?? null,
          sourceFileName: dashboardState.importedFile?.fileName ?? null,
          currentSkills: buildCurrentSkillsPayload(),
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error ?? "导出失败。");
      }

      const blob = await response.blob();
      const exportFileName = response.headers.get("x-export-file") ?? "claude-skills.zip";
      const deliveryMode = await deliverExportFile(blob, exportFileName);

      await refreshState();
      if (deliveryMode === "shared") {
        setStatusMessage("已调起系统分享，可直接保存或发送导出的文件。");
        return;
      }

      if (deliveryMode === "opened") {
        setStatusMessage("已在新页面打开导出文件，手机端可使用浏览器的保存或分享能力完成下载。");
        return;
      }

      setStatusMessage(analysisSelection === "all-skills" ? "三种 skill 已打包导出。" : "单个 Markdown 文件已导出。");
    } catch (exportError) {
      if (exportError instanceof DOMException && exportError.name === "AbortError") {
        setStatusMessage("已取消导出分享。");
        return;
      }

      setStatusMessage(exportError instanceof Error ? exportError.message : "导出失败。");
    }
  }

  return (
    <main className="min-h-screen bg-background px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:gap-4">
        {/* Tabs */}
        {dashboardState.questions.length === 0 ? (
          <Card className="rounded-2xl">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              未检测到可用问题。请在项目根目录放置 QUESTION.md 后刷新页面。
            </CardContent>
          </Card>
        ) : (
          <>
            <ScrollArea className="-mx-1 w-[calc(100%+0.5rem)] whitespace-nowrap px-1 sm:mx-0 sm:w-full sm:px-0">
              <Tabs
                value={selectedQuestionId}
                onValueChange={(value) => setSelectedQuestionId(value)}
                className="w-full"
              >
                <TabsList className="min-w-max [--radius:9999px]">
                  {dashboardState.questions.map((question) => (
                      <TabsTrigger
                        key={question.id}
                        value={question.id}
                        onClick={() => setSelectedQuestionId(question.id)}
                        className="min-w-max px-3 text-sm"
                      >
                        {stripTitleNumber(question.title)}
                      </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </ScrollArea>

            {/* Tab content */}
            {selectedQuestion ? (
              <div className="flex flex-col gap-4 sm:gap-5">
                {(() => {
                  const groups = getQuestionGroups(selectedQuestion);

                  return (
                    <>
                {/* Supplement text */}
                {selectedQuestion.supplement ? (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {selectedQuestion.supplement}
                  </p>
                ) : null}

                {/* Question groups */}
                {groups.map((group, groupIndex) => (
                  <Card key={group.id} className="rounded-2xl">
                    <CardContent className="flex flex-col gap-4 p-4 sm:p-5">
                      {group.title ? (
                        <p className="text-sm font-semibold text-foreground">{group.title}</p>
                      ) : null}

                      {group.prompts.map((prompt, promptIndex) => (
                        <div key={`${group.id}:${promptIndex}`} className="flex flex-col gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {promptIndex + 1}. {prompt}
                          </p>
                          <Textarea
                            ref={(element) => setPromptRef(promptKey(groupIndex, promptIndex), element)}
                            value={getAnswer(groupIndex, promptIndex)}
                            onChange={(event) =>
                              setAnswer(groupIndex, promptIndex, event.target.value)
                            }
                            aria-invalid={invalidPromptKeys.includes(promptKey(groupIndex, promptIndex))}
                            className="min-h-28 resize-y text-sm sm:min-h-24"
                            placeholder="请输入你的回答…"
                          />
                          {invalidPromptKeys.includes(promptKey(groupIndex, promptIndex)) ? (
                            <p className="text-xs text-destructive">此项为必填，请先填写后再分析。</p>
                          ) : null}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}

                {groups.length === 0 ? (
                  <Card className="rounded-2xl">
                    <CardContent className="py-8 text-sm text-muted-foreground">
                      当前章节没有可填写的问题组。
                    </CardContent>
                  </Card>
                ) : null}
                    </>
                  );
                })()}

                {/* Actions */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                    <Button
                      variant="outline"
                      onClick={() => startExportTransition(() => void performExport())}
                      disabled={isExporting || isSubmitting || (dashboardState.savedResponses.length === 0 && !latestAssistantText)}
                      className="w-full sm:w-auto"
                    >
                      {isExporting ? (
                        <LoaderCircle data-icon="inline-start" className="animate-spin" />
                      ) : (
                        <Download data-icon="inline-start" />
                      )}
                      导出
                    </Button>
                    <Button
                      variant="outline"
                      disabled={isSaving}
                      onClick={() => startSaveTransition(() => void performSave())}
                      className="w-full sm:w-auto"
                    >
                      {isSaving ? (
                        <LoaderCircle data-icon="inline-start" className="animate-spin" />
                      ) : (
                        <Save data-icon="inline-start" />
                      )}
                      保存
                    </Button>
                    <select
                      value={analysisSelection}
                      onChange={(event) => setAnalysisSelection(event.target.value as AnalysisSelectionId)}
                      disabled={isSubmitting}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm sm:h-9 sm:w-auto"
                    >
                      {ANALYSIS_MODES.map((mode) => (
                        <option key={mode.id} value={mode.id}>
                          {mode.label}
                        </option>
                      ))}
                      <option value="all-skills">全部解析</option>
                    </select>
                    <Button
                      disabled={isSubmitting}
                      onClick={() => void handleSend()}
                      className="w-full sm:w-auto"
                    >
                      {isSubmitting ? (
                        <LoaderCircle data-icon="inline-start" className="animate-spin" />
                      ) : (
                        <Send data-icon="inline-start" />
                      )}
                      提交并整理
                    </Button>
                  </div>
                </div>

                {/* AI organized result */}
                {latestAssistantText ? (
                  <>
                    <Separator />
                    <Card className="rounded-2xl bg-muted/30">
                      <CardContent className="p-4 sm:p-5">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          AI 整理结果
                        </p>
                        <Textarea
                          value={organizedResult}
                          onChange={(event) => setOrganizedResult(event.target.value)}
                          className="min-h-56 resize-y text-sm leading-7 sm:min-h-64"
                          placeholder="整理结果将在这里显示，你可以继续编辑后保存或导出。"
                        />
                      </CardContent>
                    </Card>
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        {/* Status */}
        {statusMessage ? (
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-foreground">
            {statusMessage}
          </div>
        ) : null}
      </div>
    </main>
  );
}