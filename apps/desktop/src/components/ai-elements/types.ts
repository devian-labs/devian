// Local structural shims for the handful of Vercel AI SDK types that the
// generated ai-elements components reference via `import type`. This app
// doesn't use the `ai` package at runtime (chat goes through Tauri invoke,
// not useChat/streaming), so these are kept in-repo instead of adding the
// real `ai` package (and its @ai-sdk/* + zod dependency chain) for types
// that are only ever erased at build time.

export type UIMessage = {
  role: "system" | "user" | "assistant";
};

export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export type FileUIPart = {
  type: "file";
  mediaType: string;
  filename?: string;
  url: string;
};

export type SourceDocumentUIPart = {
  type: "source-document";
  sourceId: string;
  mediaType: string;
  title: string;
  filename?: string;
  url?: string;
};

export type ToolUIPartState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export type ToolUIPart = {
  type: `tool-${string}`;
  toolCallId: string;
  state: ToolUIPartState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type DynamicToolUIPart = {
  type: "dynamic-tool";
  toolCallId: string;
  toolName: string;
  state: ToolUIPartState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};
