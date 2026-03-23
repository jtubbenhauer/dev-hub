"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  QuestionAnswer,
  QuestionInfo,
  QuestionRequest,
} from "@/lib/opencode/types";
import { Check, MessageCircleQuestion, X } from "lucide-react";
import type { ReactNode } from "react";
import { Component, useState } from "react";

export class QuestionErrorBoundary extends Component<
  { children: ReactNode; onDismissAll: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onDismissAll: () => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[chat] QuestionBanner render error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
          <span>Could not display question.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={this.props.onDismissAll}
            className="h-6 gap-1 px-2 text-xs"
          >
            <X className="size-3" />
            Dismiss
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function QuestionBanner({
  request,
  viewMode = "list",
  onReply,
  onReject,
}: {
  request: QuestionRequest;
  viewMode?: "list" | "tabs";
  onReply: (answers: QuestionAnswer[]) => void;
  onReject: () => void;
}) {
  const questionList = request.questions ?? [];
  const [activeTab, setActiveTab] = useState(0);

  const [selections, setSelections] = useState<string[][]>(() =>
    questionList.map(() => []),
  );
  const [customInputs, setCustomInputs] = useState<string[]>(() =>
    questionList.map(() => ""),
  );

  const toggleOption = (
    questionIndex: number,
    label: string,
    isMultiple: boolean,
  ) => {
    setSelections((prev) => {
      const next = [...prev];
      const current = next[questionIndex] ?? [];
      if (isMultiple) {
        next[questionIndex] = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
      } else {
        next[questionIndex] = current.includes(label) ? [] : [label];
      }
      return next;
    });
  };

  const handleSubmit = () => {
    const answers: QuestionAnswer[] = questionList.map((q, i) => {
      const selected = selections[i];
      const custom = customInputs[i].trim();
      if (custom && selected.length === 0) return [custom];
      if (custom) return [...selected, custom];
      return selected;
    });
    onReply(answers);
  };

  const hasAnySelection =
    selections.some((s) => s.length > 0) ||
    customInputs.some((c) => c.trim().length > 0);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey && hasAnySelection) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const useTabs = viewMode === "tabs" && questionList.length > 1;

  return (
    <div className="space-y-3 rounded-lg border border-indigo-500/50 bg-indigo-500/5 px-3 py-2">
      {useTabs ? (
        <>
          <div className="-mx-3 flex gap-1 overflow-x-auto border-b border-indigo-500/20 px-3">
            {questionList.map((q, i) => {
              const hasSelection =
                (selections[i]?.length ?? 0) > 0 ||
                (customInputs[i]?.trim().length ?? 0) > 0;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveTab(i)}
                  className={cn(
                    "-mb-px shrink-0 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                    activeTab === i
                      ? "border-indigo-500 text-indigo-700 dark:text-indigo-300"
                      : "text-muted-foreground hover:text-foreground border-transparent",
                  )}
                >
                  {q.header}
                  {hasSelection && (
                    <span className="ml-1.5 inline-block size-1.5 rounded-full bg-indigo-500" />
                  )}
                </button>
              );
            })}
          </div>
          <QuestionItem
            question={questionList[activeTab]}
            selected={selections[activeTab]}
            customInput={customInputs[activeTab]}
            onToggleOption={(label) =>
              toggleOption(
                activeTab,
                label,
                questionList[activeTab].multiple === true,
              )
            }
            onCustomInputChange={(value) => {
              setCustomInputs((prev) => {
                const next = [...prev];
                next[activeTab] = value;
                return next;
              });
            }}
            onSubmitOnEnter={handleInputKeyDown}
          />
        </>
      ) : (
        questionList.map((q, questionIndex) => (
          <QuestionItem
            key={questionIndex}
            question={q}
            selected={selections[questionIndex]}
            customInput={customInputs[questionIndex]}
            onToggleOption={(label) =>
              toggleOption(questionIndex, label, q.multiple === true)
            }
            onCustomInputChange={(value) => {
              setCustomInputs((prev) => {
                const next = [...prev];
                next[questionIndex] = value;
                return next;
              });
            }}
            onSubmitOnEnter={handleInputKeyDown}
          />
        ))
      )}
      <div className="flex justify-end gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={onReject}
          className="gap-1"
        >
          <X className="size-3" />
          Skip
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!hasAnySelection}
          className="gap-1"
        >
          <Check className="size-3" />
          Reply
        </Button>
      </div>
    </div>
  );
}

function QuestionItem({
  question,
  selected,
  customInput,
  onToggleOption,
  onCustomInputChange,
  onSubmitOnEnter,
}: {
  question: QuestionInfo;
  selected: string[];
  customInput: string;
  onToggleOption: (label: string) => void;
  onCustomInputChange: (value: string) => void;
  onSubmitOnEnter: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const allowCustom = question.custom !== false;
  const options = question.options ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-0.5 size-5 shrink-0 text-indigo-600" />
        <div>
          <p className="text-sm font-medium">{question.header}</p>
          <p className="text-muted-foreground text-xs">{question.question}</p>
        </div>
      </div>

      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-7">
          {options.map((option) => {
            const isSelected = selected.includes(option.label);
            return (
              <button
                key={option.label}
                onClick={() => onToggleOption(option.label)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-500/20 text-indigo-700 dark:text-indigo-300"
                    : "border-border bg-background hover:bg-muted"
                }`}
                title={option.description}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      {allowCustom && (
        <div className="pl-7">
          <Input
            value={customInput}
            onChange={(e) => onCustomInputChange(e.target.value)}
            onKeyDown={onSubmitOnEnter}
            placeholder="Type a custom answer..."
            className="h-8 text-xs"
          />
        </div>
      )}
    </div>
  );
}
