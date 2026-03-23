"use client";

import {
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useEffect,
} from "react";
import { Send, Square, X, MessageSquare, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilePicker } from "@/components/chat/file-picker";
import {
  CommandPicker,
  type SlashCommand,
} from "@/components/chat/command-picker";
import { PlanArgPicker } from "@/components/chat/plan-arg-picker";
import { cn } from "@/lib/utils";
import type { Agent, Command } from "@/lib/opencode/types";
import { AgentSelector } from "@/components/chat/agent-selector";
import { ModelSelector } from "@/components/chat/model-selector";
import { VariantSelector } from "@/components/chat/variant-selector";
import type { Attachment } from "@/lib/attachment-utils";
import {
  MAX_ATTACHMENTS,
  validateAttachment,
  fileToDataUrl,
  generateAttachmentId,
} from "@/lib/attachment-utils";
import {
  getPendingCommentChips,
  clearPendingCommentChips,
  getAllCachedComments,
  type CommentChip,
} from "@/lib/comment-chat-bridge";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export interface PromptInputHandle {
  focus: () => void;
  setValue: (text: string) => void;
}

type SessionDraft = {
  text: string;
  commentChips: CommentChip[];
  files: string[];
  attachments: Attachment[];
};

const sessionDrafts = new Map<string, SessionDraft>();

interface SelectedModel {
  providerID: string;
  modelID: string;
}

interface SubmitAttachment {
  mime: string;
  dataUrl: string;
  filename: string;
}

interface PromptInputProps {
  onSubmit: (text: string, attachments?: SubmitAttachment[]) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  workspaceId: string | null;
  sessionId: string | null;
  commands: Command[];
  onCommandSelect: (command: SlashCommand, args: string) => void;

  agents: Agent[];
  selectedAgent: string | null;
  onAgentChange: (agent: string) => void;
  isAgentSelectorOpen?: boolean;
  onAgentSelectorOpenChange?: (open: boolean) => void;

  selectedModel: SelectedModel | null;
  onModelChange: (model: SelectedModel) => void;
  onVariantsChange?: (variants: string[]) => void;
  isModelSelectorOpen?: boolean;
  onModelSelectorOpenChange?: (open: boolean) => void;

  availableVariants: string[];
  selectedVariant: string | null;
  onVariantChange: (variant: string | null) => void;
  isVariantSelectorOpen?: boolean;
  onVariantSelectorOpenChange?: (open: boolean) => void;
}

export const PromptInput = forwardRef<PromptInputHandle, PromptInputProps>(
  function PromptInput(
    {
      onSubmit,
      onAbort,
      isStreaming,
      disabled,
      workspaceId,
      sessionId,
      commands,
      onCommandSelect,
      agents,
      selectedAgent,
      onAgentChange,
      isAgentSelectorOpen,
      onAgentSelectorOpenChange,
      selectedModel,
      onModelChange,
      onVariantsChange,
      isModelSelectorOpen,
      onModelSelectorOpenChange,
      availableVariants,
      selectedVariant,
      onVariantChange,
      isVariantSelectorOpen,
      onVariantSelectorOpenChange,
    },
    ref,
  ) {
    const queryClient = useQueryClient();
    const [value, setValue] = useState(() => {
      const draft = sessionId ? sessionDrafts.get(sessionId) : undefined;
      return draft?.text ?? "";
    });
    const [selectedFiles, setSelectedFiles] = useState<string[]>(() => {
      const draft = sessionId ? sessionDrafts.get(sessionId) : undefined;
      return draft?.files ?? [];
    });
    const [selectedComments, setSelectedComments] = useState<CommentChip[]>(
      () => {
        const draft = sessionId ? sessionDrafts.get(sessionId) : undefined;
        return draft?.commentChips ?? [];
      },
    );
    const [attachments, setAttachments] = useState<Attachment[]>(() => {
      const draft = sessionId ? sessionDrafts.get(sessionId) : undefined;
      return draft?.attachments ?? [];
    });
    const [isDragging, setIsDragging] = useState(false);
    const [pickerQuery, setPickerQuery] = useState<string | null>(null);
    const [commandQuery, setCommandQuery] = useState<string | null>(null);
    const [planArgQuery, setPlanArgQuery] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [prevSessionId, setPrevSessionId] = useState(sessionId);

    if (prevSessionId !== sessionId) {
      if (prevSessionId) {
        sessionDrafts.set(prevSessionId, {
          text: value,
          commentChips: selectedComments,
          files: selectedFiles,
          attachments,
        });
      }
      setPrevSessionId(sessionId);
      const draft = sessionId ? sessionDrafts.get(sessionId) : undefined;
      setValue(draft?.text ?? "");
      setSelectedComments(draft?.commentChips ?? []);
      setSelectedFiles(draft?.files ?? []);
      setAttachments(draft?.attachments ?? []);
    }

    useEffect(() => {
      // Resize textarea after session switch restores text
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }, [value]);

    useEffect(() => {
      if (!sessionId) return;
      const hasContent =
        value ||
        selectedComments.length > 0 ||
        selectedFiles.length > 0 ||
        attachments.length > 0;
      if (hasContent) {
        sessionDrafts.set(sessionId, {
          text: value,
          commentChips: selectedComments,
          files: selectedFiles,
          attachments,
        });
      } else {
        sessionDrafts.delete(sessionId);
      }
    }, [sessionId, value, selectedComments, selectedFiles, attachments]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => textareaRef.current?.focus(),
        setValue: (text: string) => {
          setValue(text);
          requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            textarea.style.height = "auto";
            textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
            textarea.focus();
          });
        },
      }),
      [],
    );

    // Pick up any pending comment chips on mount and when the workspace changes
    const [prevWorkspaceId, setPrevWorkspaceId] = useState<string | null>(null);
    if (prevWorkspaceId !== workspaceId) {
      setPrevWorkspaceId(workspaceId);
      if (workspaceId) {
        const chips = getPendingCommentChips(workspaceId);
        if (chips.length > 0) {
          setSelectedComments(chips);
          clearPendingCommentChips(workspaceId);
        }
      }
    }

    useEffect(() => {
      if (!workspaceId) return;

      const handleAttach = () => {
        if (!workspaceId) return;
        const incoming = getPendingCommentChips(workspaceId);
        if (incoming.length > 0) {
          setSelectedComments((prev) => {
            const existingIds = new Set(prev.map((c) => c.id));
            const newChips = incoming.filter((c) => !existingIds.has(c.id));
            return newChips.length > 0 ? [...prev, ...newChips] : prev;
          });
          clearPendingCommentChips(workspaceId);
        }
      };

      const handleDetach = (e: Event) => {
        const { commentId } = (e as CustomEvent).detail as {
          commentId: number;
        };
        setSelectedComments((prev) => prev.filter((c) => c.id !== commentId));
      };

      const handleUpdate = (e: Event) => {
        const { commentId, body } = (e as CustomEvent).detail as {
          commentId: number;
          body: string;
        };
        setSelectedComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, body } : c)),
        );
      };

      window.addEventListener("attach-comment-to-chat", handleAttach);
      window.addEventListener("detach-comment-from-chat", handleDetach);
      window.addEventListener("update-comment-in-chat", handleUpdate);
      return () => {
        window.removeEventListener("attach-comment-to-chat", handleAttach);
        window.removeEventListener("detach-comment-from-chat", handleDetach);
        window.removeEventListener("update-comment-in-chat", handleUpdate);
      };
    }, [workspaceId]);

    const autoResize = useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }, []);

    const availableCommands = useCallback((): SlashCommand[] => {
      const builtins: SlashCommand[] = [
        {
          name: "compact",
          description: "Summarize conversation to save context",
          source: "builtin",
        },
        {
          name: "undo",
          description: "Revert last assistant message changes",
          source: "builtin",
        },
      ];
      const serverCommands = commands.map((command) => ({
        name: command.name,
        description: command.description,
        source: "server" as const,
      }));
      return [...builtins, ...serverCommands];
    }, [commands]);

    const handleSubmit = useCallback(() => {
      const trimmed = value.trim();
      if (!trimmed || disabled) return;

      if (trimmed.startsWith("/")) {
        const withoutSlash = trimmed.slice(1);
        const spaceIndex = withoutSlash.indexOf(" ");
        const commandName =
          spaceIndex === -1 ? withoutSlash : withoutSlash.slice(0, spaceIndex);
        const args =
          spaceIndex === -1 ? "" : withoutSlash.slice(spaceIndex + 1);
        const match = availableCommands().find(
          (cmd) => cmd.name === commandName,
        );
        if (match) {
          onCommandSelect(match, args);
          setValue("");
          setSelectedFiles([]);
          setSelectedComments([]);
          setAttachments([]);
          setPickerQuery(null);
          setCommandQuery(null);
          setPlanArgQuery(null);
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          return;
        }
      }

      if (selectedComments.length > 0 && workspaceId) {
        const allComments = getAllCachedComments(queryClient, workspaceId);
        if (allComments.length > 0) {
          const commentMap = new Map(allComments.map((c) => [c.id, c]));
          const stale = selectedComments.filter((c) => {
            const live = commentMap.get(c.id);
            return live?.resolved === true || !live;
          });
          if (stale.length > 0) {
            toast.warning(
              `${stale.length} attached comment(s) have been resolved or deleted since you added them`,
            );
          }
        }
      }

      const commentContext =
        selectedComments.length > 0
          ? `Comment references:\n${selectedComments
              .map((c) => {
                const lineRef =
                  c.startLine === c.endLine
                    ? `${c.filePath}:${c.startLine}`
                    : `${c.filePath}:${c.startLine}-${c.endLine}`;
                return `- [comment:${c.id}] ${lineRef} — "${c.body}"`;
              })
              .join("\n")}\n\n`
          : "";
      const fileContext =
        selectedFiles.length > 0
          ? `Context files: ${selectedFiles.join(", ")}\n\n`
          : "";
      const submitAttachments =
        attachments.length > 0
          ? attachments.map((a) => ({
              mime: a.mime,
              dataUrl: a.dataUrl,
              filename: a.filename,
            }))
          : undefined;
      onSubmit(commentContext + fileContext + trimmed, submitAttachments);
      setValue("");
      setSelectedFiles([]);
      setSelectedComments([]);
      setAttachments([]);
      setPickerQuery(null);
      setCommandQuery(null);
      setPlanArgQuery(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }, [
      value,
      disabled,
      selectedFiles,
      selectedComments,
      attachments,
      onSubmit,
      availableCommands,
      onCommandSelect,
      queryClient,
      workspaceId,
    ]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        setValue(newValue);
        autoResize();

        // Detect @ trigger and track the query after it
        const cursor = e.target.selectionStart ?? newValue.length;
        const textUpToCursor = newValue.slice(0, cursor);
        const atIndex = textUpToCursor.lastIndexOf("@");

        if (atIndex !== -1) {
          const queryAfterAt = textUpToCursor.slice(atIndex + 1);
          // Only open picker if there's no space in the query (spaces close it)
          if (!queryAfterAt.includes(" ")) {
            setPickerQuery(queryAfterAt);
            return;
          }
        }
        setPickerQuery(null);

        if (newValue.startsWith("/")) {
          const firstSpace = newValue.indexOf(" ");
          const isInCommand = firstSpace === -1 || cursor <= firstSpace;
          if (isInCommand) {
            const queryEnd =
              firstSpace === -1 ? cursor : Math.min(cursor, firstSpace);
            const queryAfterSlash = newValue.slice(1, queryEnd);
            setCommandQuery(queryAfterSlash);
            setPlanArgQuery(null);
            return;
          }

          if (newValue.startsWith("/start-work ")) {
            const prefixLen = "/start-work ".length;
            if (cursor >= prefixLen) {
              const queryAfterPrefix = newValue.slice(prefixLen, cursor);
              setPlanArgQuery(queryAfterPrefix);
              setCommandQuery(null);
              return;
            }
          }
        }

        setCommandQuery(null);
        setPlanArgQuery(null);
      },
      [autoResize],
    );

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (
          event.key === "Escape" &&
          (pickerQuery !== null ||
            commandQuery !== null ||
            planArgQuery !== null)
        ) {
          event.preventDefault();
          setPickerQuery(null);
          setCommandQuery(null);
          setPlanArgQuery(null);
          return;
        }
        // Let FilePicker intercept ArrowUp/ArrowDown/Enter when picker is open
        if (
          pickerQuery !== null &&
          (event.key === "ArrowUp" ||
            event.key === "ArrowDown" ||
            event.key === "Enter")
        ) {
          event.preventDefault();
          return;
        }
        if (
          commandQuery !== null &&
          (event.key === "ArrowUp" ||
            event.key === "ArrowDown" ||
            event.key === "Enter")
        ) {
          event.preventDefault();
          return;
        }
        if (
          planArgQuery !== null &&
          (event.key === "ArrowUp" ||
            event.key === "ArrowDown" ||
            event.key === "Enter")
        ) {
          event.preventDefault();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          handleSubmit();
        }
      },
      [handleSubmit, pickerQuery, commandQuery, planArgQuery],
    );

    const handleFileSelect = useCallback(
      (path: string) => {
        // Remove the @query fragment from the textarea value
        const cursor = textareaRef.current?.selectionStart ?? value.length;
        const textUpToCursor = value.slice(0, cursor);
        const atIndex = textUpToCursor.lastIndexOf("@");
        const before = atIndex !== -1 ? value.slice(0, atIndex) : value;
        const after = value.slice(cursor);
        setValue(before + after);

        setSelectedFiles((prev) =>
          prev.includes(path) ? prev : [...prev, path],
        );
        setPickerQuery(null);

        // Restore focus
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
          autoResize();
        });
      },
      [value, autoResize],
    );

    const handleRemoveFile = useCallback((path: string) => {
      setSelectedFiles((prev) => prev.filter((p) => p !== path));
    }, []);

    const handleRemoveComment = useCallback((id: number) => {
      setSelectedComments((prev) => prev.filter((c) => c.id !== id));
    }, []);

    const handleRemoveAttachment = useCallback((id: string) => {
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    }, []);

    const addFiles = useCallback(
      async (files: File[]) => {
        for (const file of files) {
          const result = validateAttachment(file);
          if (!result.valid) {
            toast.error(result.error);
            continue;
          }
          if (attachments.length >= MAX_ATTACHMENTS) {
            toast.error(`Maximum ${MAX_ATTACHMENTS} attachments reached`);
            break;
          }
          try {
            const dataUrl = await fileToDataUrl(file);
            setAttachments((prev) => {
              if (prev.length >= MAX_ATTACHMENTS) return prev;
              return [
                ...prev,
                {
                  id: generateAttachmentId(),
                  file,
                  dataUrl,
                  mime: file.type,
                  filename: file.name,
                },
              ];
            });
          } catch {
            toast.error(`Failed to read file "${file.name}"`);
          }
        }
      },
      [attachments.length],
    );

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      // Only set false when leaving the container, not child elements
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setIsDragging(false);
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) addFiles(files);
      },
      [addFiles],
    );

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
        const items = Array.from(e.clipboardData.items);
        const imageFiles = items
          .filter(
            (item) => item.kind === "file" && item.type.startsWith("image/"),
          )
          .map((item) => item.getAsFile())
          .filter((f): f is File => f !== null);
        if (imageFiles.length > 0) {
          e.preventDefault();
          addFiles(imageFiles);
        }
      },
      [addFiles],
    );

    const handlePaperclipClick = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    const handleFileInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length > 0) addFiles(files);
        // Reset input so same file can be selected again
        if (e.target) e.target.value = "";
      },
      [addFiles],
    );

    const handleCommandSelect = useCallback((cmd: SlashCommand) => {
      setValue(`/${cmd.name} `);
      setCommandQuery(null);
      if (cmd.name === "start-work") {
        setPlanArgQuery("");
      }
      requestAnimationFrame(() => textareaRef.current?.focus());
    }, []);

    const handlePlanArgSelect = useCallback((fileName: string) => {
      setValue(`/start-work ${fileName}`);
      setPlanArgQuery(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }, []);

    const handleFocus = useCallback(() => {
      // Delay to let the keyboard animation finish before scrolling
      setTimeout(() => {
        textareaRef.current?.scrollIntoView({
          block: "end",
          behavior: "smooth",
        });
      }, 300);
    }, []);

    const isPickerOpen = pickerQuery !== null && !!workspaceId;
    const isCommandPickerOpen = commandQuery !== null;
    const isPlanArgPickerOpen = planArgQuery !== null && !!workspaceId;

    return (
      <div className="shrink-0 px-4 pt-2 pb-4">
        <div
          className={cn(
            "bg-muted/50 relative rounded-lg border",
            "focus-within:ring-ring focus-within:ring-2",
            isDragging && "ring-primary ring-2",
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="bg-primary/10 border-primary absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed">
              <span className="text-primary text-sm font-medium">
                Drop files here
              </span>
            </div>
          )}
          {/* Picker popovers — positioned relative to this wrapper */}
          <div className="relative">
            {isPickerOpen && (
              <FilePicker
                workspaceId={workspaceId}
                query={pickerQuery}
                onSelect={handleFileSelect}
                onClose={() => setPickerQuery(null)}
              />
            )}

            {isCommandPickerOpen && (
              <CommandPicker
                commands={commands}
                query={commandQuery ?? ""}
                onSelect={handleCommandSelect}
                onClose={() => setCommandQuery(null)}
              />
            )}

            {isPlanArgPickerOpen && (
              <PlanArgPicker
                workspaceId={workspaceId}
                query={planArgQuery ?? ""}
                onSelect={handlePlanArgSelect}
                onClose={() => setPlanArgQuery(null)}
              />
            )}
          </div>

          {/* Selected file chips */}
          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {selectedFiles.map((path) => {
                const fileName = path.split("/").pop() ?? path;
                return (
                  <span
                    key={path}
                    className="bg-muted flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
                  >
                    <span className="text-muted-foreground">@</span>
                    {fileName}
                    <button
                      onClick={() => handleRemoveFile(path)}
                      className="text-muted-foreground hover:text-foreground ml-0.5"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Comment context chips */}
          {selectedComments.length > 0 && (
            <div
              className={cn(
                "flex flex-wrap gap-1.5 px-3",
                selectedFiles.length > 0 ? "pt-1" : "pt-2",
              )}
            >
              {selectedComments.map((comment) => {
                const fileName =
                  comment.filePath.split("/").pop() ?? comment.filePath;
                const lineLabel =
                  comment.startLine === comment.endLine
                    ? `${fileName}:${comment.startLine}`
                    : `${fileName}:${comment.startLine}-${comment.endLine}`;
                return (
                  <span
                    key={comment.id}
                    className="bg-primary/10 flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
                  >
                    <MessageSquare className="text-primary size-3" />
                    {lineLabel}
                    <button
                      onClick={() => handleRemoveComment(comment.id)}
                      aria-label={`Remove comment ${fileName}:${comment.startLine}`}
                      className="text-muted-foreground hover:text-foreground ml-0.5"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div
              className={cn(
                "flex flex-wrap gap-1.5 px-3",
                selectedFiles.length > 0 || selectedComments.length > 0
                  ? "pt-1"
                  : "pt-2",
              )}
            >
              {attachments.map((attachment) => {
                const truncatedName =
                  attachment.filename.length > 20
                    ? attachment.filename.slice(0, 17) + "..."
                    : attachment.filename;
                return (
                  <span
                    key={attachment.id}
                    className="bg-muted flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs"
                  >
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.filename}
                      className="size-6 shrink-0 rounded object-cover"
                    />
                    <span className="truncate">{truncatedName}</span>
                    <button
                      onClick={() => handleRemoveAttachment(attachment.id)}
                      aria-label={`Remove ${attachment.filename}`}
                      className="text-muted-foreground hover:text-foreground ml-0.5"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                );
              })}
              {attachments.length >= MAX_ATTACHMENTS && (
                <span className="text-muted-foreground py-0.5 text-xs">
                  Max {MAX_ATTACHMENTS} files
                </span>
              )}
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onPaste={handlePaste}
            placeholder="Send a message... (type @ to reference files)"
            disabled={disabled}
            rows={1}
            className="placeholder:text-muted-foreground max-h-[200px] w-full resize-none bg-transparent px-3 py-2 text-base focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          />

          {/* Footer bar */}
          <div className="flex items-center gap-1 border-t px-2 py-1.5">
            {/* Paperclip placeholder button (left side) */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
              onClick={handlePaperclipClick}
              aria-label="Attach files"
            >
              <Paperclip className="size-3.5" />
            </Button>

            {/* Selectors */}
            <AgentSelector
              agents={agents}
              selectedAgent={selectedAgent}
              onAgentChange={onAgentChange}
              open={isAgentSelectorOpen}
              onOpenChange={onAgentSelectorOpenChange}
            />
            <ModelSelector
              workspaceId={workspaceId}
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              onVariantsChange={onVariantsChange}
              open={isModelSelectorOpen}
              onOpenChange={onModelSelectorOpenChange}
            />
            <VariantSelector
              variants={availableVariants}
              selectedVariant={selectedVariant}
              onVariantChange={onVariantChange}
              open={isVariantSelectorOpen}
              onOpenChange={onVariantSelectorOpenChange}
            />

            {/* Spacer */}
            <div className="flex-1" />

            {/* Stop button (when streaming) */}
            {isStreaming && (
              <Button
                type="button"
                size="icon"
                variant="destructive"
                onClick={onAbort}
                className="size-7 shrink-0"
              >
                <Square className="size-3.5" />
              </Button>
            )}

            {/* Send button */}
            <Button
              type="button"
              size="icon"
              onClick={handleSubmit}
              disabled={!value.trim() || disabled}
              className="size-7 shrink-0"
            >
              <Send className="size-3.5" />
            </Button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
      </div>
    );
  },
);
