/**
 * Session management for the Telegram bot.
 *
 * The session wrapper supports:
 * - Claude Code via Anthropic Agent SDK
 * - Codex via @openai/codex-sdk
 *
 * We intentionally keep one shared session abstraction so all handlers
 * (text/voice/photo/document/callback) continue to use the same API.
 */

import {
  query,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { readFileSync } from "fs";
import type { Context } from "grammy";
import {
  AI_ASSISTANT,
  ALLOWED_PATHS,
  CLAUDE_ENABLE_CHROME,
  CLAUDE_REASONING_EFFORT,
  CLAUDE_MODEL,
  CODEX_APPROVAL_POLICY,
  CODEX_MODEL,
  CODEX_NETWORK_ACCESS_ENABLED,
  CODEX_REASONING_EFFORT,
  CODEX_SANDBOX_MODE,
  CODEX_WEB_SEARCH_MODE,
  type ClaudeReasoningEffort,
  type CodexReasoningEffort,
  MCP_SERVERS,
  SAFETY_PROMPT,
  SESSION_FILE,
  STREAMING_DEBUG,
  STREAMING_SYNTHETIC_FALLBACK_MIN_CHARS,
  STREAMING_SYNTHETIC_STEP_CHARS,
  STREAMING_SYNTHETIC_STEP_DELAY_MS,
  STREAMING_THROTTLE_MS,
  TEMP_PATHS,
  THINKING_DEEP_KEYWORDS,
  THINKING_KEYWORDS,
  WORKING_DIR,
} from "./config";
import { formatToolStatus } from "./formatting";
import { checkPendingAskUserRequests } from "./handlers/streaming";
import { checkCommandSafety, isPathAllowed } from "./security";
import type {
  SavedSession,
  SessionHistory,
  StatusCallback,
  TokenUsage,
} from "./types";

/**
 * Determine thinking token budget based on message keywords.
 */
function getThinkingLevel(
  message: string,
  defaultEffort: ClaudeReasoningEffort
): number {
  const msgLower = message.toLowerCase();
  const baseThinkingTokens =
    defaultEffort === "high" ? 50000 : defaultEffort === "medium" ? 10000 : 0;

  // Check deep thinking triggers first (more specific)
  if (THINKING_DEEP_KEYWORDS.some((k) => msgLower.includes(k))) {
    return Math.max(baseThinkingTokens, 50000);
  }

  // Check normal thinking triggers
  if (THINKING_KEYWORDS.some((k) => msgLower.includes(k))) {
    return Math.max(baseThinkingTokens, 10000);
  }

  return baseThinkingTokens;
}

/**
 * Extract text content from SDK message.
 */
function getTextFromMessage(msg: SDKMessage): string | null {
  if (msg.type !== "assistant") return null;

  const textParts: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === "text") {
      textParts.push(block.text);
    }
  }
  return textParts.length > 0 ? textParts.join("") : null;
}

/**
 * Manages Claude Code sessions using the Agent SDK V1.
 */
// Maximum number of sessions to keep in history
const MAX_SESSIONS = 5;
type AssistantMode = "claude" | "codex";

function compactToken(value: string): string {
  return value.toLowerCase().replace(/[\s._-]+/g, "");
}

function isCodexAlias(base: string): boolean {
  return compactToken(base) === "codex";
}

function isCodex53Alias(base: string): boolean {
  const compact = compactToken(base);
  return compact === "codex53" || compact === "gpt53codex";
}

function parseEffortToken(token: string): CodexReasoningEffort | null {
  const compact = compactToken(token);
  if (
    compact === "minimal" ||
    compact === "low" ||
    compact === "medium" ||
    compact === "high" ||
    compact === "xhigh"
  ) {
    return compact;
  }
  return null;
}

function parseClaudeAlias(selection: string): string | null {
  const compact = compactToken(selection);
  if (compact === "claude46opus" || compact === "opus46") {
    return "claude-opus-4-6";
  }
  if (compact === "claude45sonnet" || compact === "sonnet45") {
    return "claude-sonnet-4-5";
  }
  return null;
}

function parseCodexPreset(
  selection: string
): { model: string; effort: CodexReasoningEffort } | null {
  const normalized = selection.toLowerCase().trim();

  // Supports:
  // - codex 5.3 high
  // - gpt-5.3-codex medium
  // - codex high
  // - codex5.3high
  const spacedMatch = normalized.match(
    /^(.*?)[\s_-]+(minimal|low|medium|high|xhigh)$/
  );
  if (spacedMatch) {
    const base = spacedMatch[1]!.trim();
    const effort = parseEffortToken(spacedMatch[2]!);
    if (!effort) return null;
    if (isCodex53Alias(base)) {
      return { model: "gpt-5.3-codex", effort };
    }
    if (isCodexAlias(base)) {
      return { model: CODEX_MODEL, effort };
    }
  }

  const compact = compactToken(selection);
  const compactMatch = compact.match(
    /^(codex53|gpt53codex|codex)(minimal|low|medium|high|xhigh)$/
  );
  if (!compactMatch) {
    return null;
  }

  const effort = parseEffortToken(compactMatch[2]!);
  if (!effort) {
    return null;
  }

  const model = compactMatch[1] === "codex" ? CODEX_MODEL : "gpt-5.3-codex";
  return { model, effort };
}

/**
 * A single Codex client is reused for the process lifetime.
 * This keeps thread resume behavior consistent and avoids redundant auth bootstrap.
 */
let codexClient: Codex | null = null;
function getCodexClient(): Codex {
  if (!codexClient) {
    codexClient = new Codex();
  }
  return codexClient;
}

class ClaudeSession {
  sessionId: string | null = null;
  lastActivity: Date | null = null;
  queryStarted: Date | null = null;
  currentTool: string | null = null;
  lastTool: string | null = null;
  lastError: string | null = null;
  lastErrorTime: Date | null = null;
  lastUsage: TokenUsage | null = null;
  lastMessage: string | null = null;
  conversationTitle: string | null = null;
  private assistantMode: AssistantMode = AI_ASSISTANT;
  private claudeModel = CLAUDE_MODEL;
  private claudeEffort: ClaudeReasoningEffort = CLAUDE_REASONING_EFFORT;
  private codexModel = CODEX_MODEL;
  private codexEffort: CodexReasoningEffort = CODEX_REASONING_EFFORT;

  private abortController: AbortController | null = null;
  private isQueryRunning = false;
  private stopRequested = false;
  private _isProcessing = false;
  private _wasInterruptedByNewMessage = false;

  get isActive(): boolean {
    return this.sessionId !== null;
  }

  get isRunning(): boolean {
    return this.isQueryRunning || this._isProcessing;
  }

  get assistant(): AssistantMode {
    return this.assistantMode;
  }

  get model(): string {
    return this.assistantMode === "codex" ? this.codexModel : this.claudeModel;
  }

  get codexReasoningEffort(): CodexReasoningEffort {
    return this.codexEffort;
  }

  get claudeReasoningEffort(): ClaudeReasoningEffort {
    return this.claudeEffort;
  }

  get modelDisplay(): string {
    if (this.assistantMode === "codex") {
      if (compactToken(this.codexModel) === "gpt53codex") {
        return `codex 5.3 ${this.codexEffort}`;
      }
      return `${this.codexModel} (${this.codexEffort})`;
    }
    if (compactToken(this.claudeModel) === "claudeopus46") {
      return "opus 4.6";
    }
    if (compactToken(this.claudeModel) === "claudesonnet45") {
      return "sonnet 4.5";
    }
    return this.claudeModel;
  }

  get modelDebug(): string {
    if (this.assistantMode === "codex") {
      return `${this.codexModel} (${this.codexEffort})`;
    }
    return this.claudeModel;
  }

  /**
   * Check if the last stop was triggered by a new message interrupt (! prefix).
   * Resets the flag when called. Also clears stopRequested so new messages can proceed.
   */
  consumeInterruptFlag(): boolean {
    const was = this._wasInterruptedByNewMessage;
    this._wasInterruptedByNewMessage = false;
    if (was) {
      // Clear stopRequested so the new message can proceed
      this.stopRequested = false;
    }
    return was;
  }

  /**
   * Mark that this stop is from a new message interrupt.
   */
  markInterrupt(): void {
    this._wasInterruptedByNewMessage = true;
  }

  /**
   * Clear the stopRequested flag (used after interrupt to allow new message to proceed).
   */
  clearStopRequested(): void {
    this.stopRequested = false;
  }

  /**
   * Update the active assistant/model at runtime.
   *
   * Canonical examples:
   * - "opus 4.6"
   * - "sonnet 4.5"
   * - "codex 5.3 low"
   * - "codex 5.3 medium"
   * - "codex 5.3 high"
   *
   * Any non-claude value is treated as a Codex model id.
   * We clear the active session because cross-model resume can corrupt context.
   */
  setModel(selectionRaw: string): [success: boolean, message: string] {
    const selection = selectionRaw.trim();
    if (!selection) {
      return [false, "Usage: /model <opus 4.6|sonnet 4.5|codex 5.3 high|...>"];
    }

    const normalized = selection.toLowerCase();
    const previousAssistant = this.assistantMode;
    const previousModel = this.model;
    const previousCodexEffort = this.codexEffort;

    const codexPreset = parseCodexPreset(selection);
    const claudeAlias = parseClaudeAlias(selection);

    if (codexPreset) {
      this.assistantMode = "codex";
      this.codexModel = codexPreset.model;
      this.codexEffort = codexPreset.effort;
    } else if (claudeAlias) {
      this.assistantMode = "claude";
      this.claudeModel = claudeAlias;
    } else if (normalized === "claude") {
      this.assistantMode = "claude";
      this.claudeModel = CLAUDE_MODEL;
    } else if (normalized === "codex") {
      this.assistantMode = "codex";
      this.codexModel = CODEX_MODEL;
      this.codexEffort = CODEX_REASONING_EFFORT;
    } else if (normalized.startsWith("claude")) {
      return [
        false,
        "Claude models: 'opus 4.6' or 'sonnet 4.5'",
      ];
    } else {
      this.assistantMode = "codex";
      this.codexModel = selection;
    }

    const changed =
      previousAssistant !== this.assistantMode ||
      previousModel !== this.model ||
      previousCodexEffort !== this.codexEffort;
    if (!changed) {
      return [
        true,
        this.assistantMode === "codex"
          ? `Model unchanged: ${this.modelDisplay} (${this.assistantMode.toUpperCase()})`
          : `Model unchanged: ${this.modelDisplay} (${this.assistantMode.toUpperCase()})`,
      ];
    }

    // Reset active session so we don't attempt to resume with the wrong backend.
    this.sessionId = null;
    this.lastActivity = null;
    this.queryStarted = null;
    this.currentTool = null;
    this.lastTool = null;
    this.lastUsage = null;
    this.lastError = null;
    this.lastErrorTime = null;

    return [
      true,
      this.assistantMode === "codex"
        ? `Model switched to ${this.modelDisplay} (${this.assistantMode.toUpperCase()}). Started a fresh session.`
        : `Model switched to ${this.modelDisplay} (${this.assistantMode.toUpperCase()}). Started a fresh session.`,
    ];
  }

  /**
   * Mark processing as started.
   * Returns a cleanup function to call when done.
   */
  startProcessing(): () => void {
    this._isProcessing = true;
    return () => {
      this._isProcessing = false;
    };
  }

  /**
   * Stop the currently running query or mark for cancellation.
   * Returns: "stopped" if query was aborted, "pending" if processing will be cancelled, false if nothing running
   */
  async stop(): Promise<"stopped" | "pending" | false> {
    // If a query is actively running, abort it
    if (this.isQueryRunning && this.abortController) {
      this.stopRequested = true;
      this.abortController.abort();
      console.log("Stop requested - aborting current query");
      return "stopped";
    }

    // Codex streamed turns do not expose an AbortController in this wrapper.
    // We still honor /stop by setting a flag consumed inside the event loop.
    if (this.isQueryRunning) {
      this.stopRequested = true;
      console.log("Stop requested - will stop current Codex turn");
      return "stopped";
    }

    // If processing but query not started yet
    if (this._isProcessing) {
      this.stopRequested = true;
      console.log("Stop requested - will cancel before query starts");
      return "pending";
    }

    return false;
  }

  /**
   * Send a message to Claude with streaming updates via callback.
   *
   * @param ctx - grammY context for ask_user button display
   */
  async sendMessageStreaming(
    message: string,
    username: string,
    userId: number,
    statusCallback: StatusCallback,
    chatId?: number,
    ctx?: Context
  ): Promise<string> {
    if (this.assistantMode === "codex") {
      return this.sendMessageStreamingCodex(
        message,
        username,
        userId,
        statusCallback,
        chatId
      );
    }

    // Set chat context for ask_user MCP tool
    if (chatId) {
      process.env.TELEGRAM_CHAT_ID = String(chatId);
    }

    const isNewSession = !this.isActive;
    const thinkingTokens = getThinkingLevel(message, this.claudeEffort);
    const thinkingLabel =
      { 0: "off", 10000: "normal", 50000: "deep" }[thinkingTokens] ||
      String(thinkingTokens);

    // Inject current date/time at session start so Claude doesn't need to call a tool for it
    let messageToSend = message;
    if (isNewSession) {
      const now = new Date();
      const datePrefix = `[Current date/time: ${now.toLocaleDateString(
        "en-US",
        {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        }
      )}]\n\n`;
      messageToSend = datePrefix + message;
    }

    // Build SDK V1 options - supports all features
    const options: Options = {
      model: this.claudeModel,
      cwd: WORKING_DIR,
      settingSources: ["user", "project"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      systemPrompt: SAFETY_PROMPT,
      mcpServers: MCP_SERVERS,
      extraArgs: CLAUDE_ENABLE_CHROME ? { chrome: null } : undefined,
      maxThinkingTokens: thinkingTokens,
      additionalDirectories: ALLOWED_PATHS,
      resume: this.sessionId || undefined,
    };

    // Add Claude Code executable path if set (required for standalone builds)
    if (process.env.CLAUDE_CODE_PATH) {
      options.pathToClaudeCodeExecutable = process.env.CLAUDE_CODE_PATH;
    }

    if (this.sessionId && !isNewSession) {
      console.log(
        `RESUMING session ${this.sessionId.slice(
          0,
          8
        )}... (thinking=${thinkingLabel})`
      );
    } else {
      console.log(`STARTING new Claude session (thinking=${thinkingLabel})`);
      this.sessionId = null;
    }

    // Check if stop was requested during processing phase
    if (this.stopRequested) {
      console.log(
        "Query cancelled before starting (stop was requested during processing)"
      );
      this.stopRequested = false;
      throw new Error("Query cancelled");
    }

    // Create abort controller for cancellation
    this.abortController = new AbortController();
    this.isQueryRunning = true;
    this.stopRequested = false;
    this.queryStarted = new Date();
    this.currentTool = null;

    // Response tracking
    const responseParts: string[] = [];
    let currentSegmentId = 0;
    let currentSegmentText = "";
    let lastTextUpdate = 0;
    let textCallbackCount = 0;
    let lastEmittedTextLength = 0;
    let queryCompleted = false;
    let askUserTriggered = false;
    let streamEventCount = 0;
    let assistantEventCount = 0;
    let textBlockCount = 0;

    const emitProgressiveTail = async (
      fullText: string,
      segmentId: number
    ): Promise<void> => {
      if (
        fullText.length < STREAMING_SYNTHETIC_FALLBACK_MIN_CHARS ||
        STREAMING_SYNTHETIC_STEP_CHARS <= 0
      ) {
        return;
      }

      const start = Math.max(
        lastEmittedTextLength + STREAMING_SYNTHETIC_STEP_CHARS,
        STREAMING_SYNTHETIC_STEP_CHARS
      );

      if (STREAMING_DEBUG && start < fullText.length) {
        console.log(
          `[stream-debug] synthetic tail start=${start} full_len=${fullText.length} step=${STREAMING_SYNTHETIC_STEP_CHARS} delay_ms=${STREAMING_SYNTHETIC_STEP_DELAY_MS}`
        );
      }
      for (
        let end = start;
        end < fullText.length;
        end += STREAMING_SYNTHETIC_STEP_CHARS
      ) {
        await statusCallback("text", fullText.slice(0, end), segmentId);
        textCallbackCount++;
        lastEmittedTextLength = end;

        if (STREAMING_SYNTHETIC_STEP_DELAY_MS > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, STREAMING_SYNTHETIC_STEP_DELAY_MS)
          );
        }
      }
    };

    try {
      // Use V1 query() API - supports all options including cwd, mcpServers, etc.
      const queryInstance = query({
        prompt: messageToSend,
        options: {
          ...options,
          abortController: this.abortController,
        },
      });

      // Process streaming response
      for await (const event of queryInstance) {
        streamEventCount++;

        // Check for abort
        if (this.stopRequested) {
          console.log("Query aborted by user");
          break;
        }

        // Capture session_id from first message
        if (!this.sessionId && event.session_id) {
          this.sessionId = event.session_id;
          console.log(`GOT session_id: ${this.sessionId!.slice(0, 8)}...`);
          this.saveSession();
        }

        // Handle different message types
        if (event.type === "assistant") {
          assistantEventCount++;

          for (const block of event.message.content) {
            // Thinking blocks
            if (block.type === "thinking") {
              const thinkingText = block.thinking;
              if (thinkingText) {
                console.log(`THINKING BLOCK: ${thinkingText.slice(0, 100)}...`);
                await statusCallback("thinking", thinkingText);
              }
            }

            // Tool use blocks
            if (block.type === "tool_use") {
              const toolName = block.name;
              const toolInput = block.input as Record<string, unknown>;

              // Safety check for Bash commands
              if (toolName === "Bash") {
                const command = String(toolInput.command || "");
                const [isSafe, reason] = checkCommandSafety(command);
                if (!isSafe) {
                  console.warn(`BLOCKED: ${reason}`);
                  await statusCallback("tool", `BLOCKED: ${reason}`);
                  throw new Error(`Unsafe command blocked: ${reason}`);
                }
              }

              // Safety check for file operations
              if (["Read", "Write", "Edit"].includes(toolName)) {
                const filePath = String(toolInput.file_path || "");
                if (filePath) {
                  // Allow reads from temp paths and .claude directories
                  const isTmpRead =
                    toolName === "Read" &&
                    (TEMP_PATHS.some((p) => filePath.startsWith(p)) ||
                      filePath.includes("/.claude/"));

                  if (!isTmpRead && !isPathAllowed(filePath)) {
                    console.warn(
                      `BLOCKED: File access outside allowed paths: ${filePath}`
                    );
                    await statusCallback("tool", `Access denied: ${filePath}`);
                    throw new Error(`File access blocked: ${filePath}`);
                  }
                }
              }

              // Segment ends when tool starts
              if (currentSegmentText) {
                await statusCallback(
                  "segment_end",
                  currentSegmentText,
                  currentSegmentId
                );
                currentSegmentId++;
                currentSegmentText = "";
              }

              // Format and show tool status
              const toolDisplay = formatToolStatus(toolName, toolInput);
              this.currentTool = toolDisplay;
              this.lastTool = toolDisplay;
              console.log(`Tool: ${toolDisplay}`);

              // Don't show tool status for ask_user - the buttons are self-explanatory
              if (!toolName.startsWith("mcp__ask-user")) {
                await statusCallback("tool", toolDisplay);
              }

              // Check for pending ask_user requests after ask-user MCP tool
              if (toolName.startsWith("mcp__ask-user") && ctx && chatId) {
                // Small delay to let MCP server write the file
                await new Promise((resolve) => setTimeout(resolve, 200));

                // Retry a few times in case of timing issues
                for (let attempt = 0; attempt < 3; attempt++) {
                  const buttonsSent = await checkPendingAskUserRequests(
                    ctx,
                    chatId
                  );
                  if (buttonsSent) {
                    askUserTriggered = true;
                    break;
                  }
                  if (attempt < 2) {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                  }
                }
              }
            }

            // Text content
            if (block.type === "text") {
              textBlockCount++;
              responseParts.push(block.text);
              currentSegmentText += block.text;

              // Some providers emit the first text block as an already-large final snapshot.
              // Emit only a short prefix first so Telegram shows visible progression.
              if (
                textCallbackCount === 0 &&
                currentSegmentText.length >=
                  STREAMING_SYNTHETIC_FALLBACK_MIN_CHARS
              ) {
                const firstPreviewLen = Math.max(
                  1,
                  Math.min(
                    STREAMING_SYNTHETIC_STEP_CHARS,
                    currentSegmentText.length - 1
                  )
                );
                await statusCallback(
                  "text",
                  currentSegmentText.slice(0, firstPreviewLen),
                  currentSegmentId
                );
                textCallbackCount++;
                lastEmittedTextLength = firstPreviewLen;
                lastTextUpdate = Date.now();
                if (STREAMING_DEBUG) {
                  console.log(
                    `[stream-debug] emitted initial prefix seg=${currentSegmentId} len=${firstPreviewLen} total_snapshot_len=${currentSegmentText.length}`
                  );
                }
                continue;
              }

              // Stream text updates:
              // - Always emit the first chunk immediately.
              // - Then throttle subsequent edits to avoid Telegram flood limits.
              const now = Date.now();
              const shouldEmitText =
                textCallbackCount === 0 ||
                now - lastTextUpdate >= STREAMING_THROTTLE_MS;

              if (shouldEmitText) {
                await statusCallback(
                  "text",
                  currentSegmentText,
                  currentSegmentId
                );
                lastTextUpdate = now;
                textCallbackCount++;
                lastEmittedTextLength = currentSegmentText.length;

                if (STREAMING_DEBUG) {
                  console.log(
                    `[stream-debug] emitted text update seg=${currentSegmentId} len=${currentSegmentText.length} block_len=${block.text.length}`
                  );
                }
              }
            }
          }

          // Break out of event loop if ask_user was triggered
          if (askUserTriggered) {
            break;
          }
        }

        // Result message
        if (event.type === "result") {
          console.log("Response complete");
          queryCompleted = true;

          if (STREAMING_DEBUG) {
            console.log(
              `[stream-debug] summary events=${streamEventCount} assistant_events=${assistantEventCount} text_blocks=${textBlockCount} text_updates=${textCallbackCount} segment_len=${currentSegmentText.length}`
            );
          }

          // Capture usage if available
          if ("usage" in event && event.usage) {
            this.lastUsage = event.usage as TokenUsage;
            const u = this.lastUsage;
            console.log(
              `Usage: in=${u.input_tokens} out=${u.output_tokens} cache_read=${
                u.cache_read_input_tokens || 0
              } cache_create=${u.cache_creation_input_tokens || 0}`
            );
          }
        }
      }

      // V1 query completes automatically when the generator ends
    } catch (error) {
      const errorStr = String(error).toLowerCase();
      const isCleanupError =
        errorStr.includes("cancel") || errorStr.includes("abort");

      if (
        isCleanupError &&
        (queryCompleted || askUserTriggered || this.stopRequested)
      ) {
        console.warn(`Suppressed post-completion error: ${error}`);
      } else {
        console.error(`Error in query: ${error}`);
        this.lastError = String(error).slice(0, 100);
        this.lastErrorTime = new Date();
        throw error;
      }
    } finally {
      this.isQueryRunning = false;
      this.abortController = null;
      this.queryStarted = null;
      this.currentTool = null;
    }

    this.lastActivity = new Date();
    this.lastError = null;
    this.lastErrorTime = null;

    // If ask_user was triggered, return early - user will respond via button
    if (askUserTriggered) {
      await statusCallback("done", "");
      return "[Waiting for user selection]";
    }

    // Emit final segment
    if (currentSegmentText) {
      await emitProgressiveTail(currentSegmentText, currentSegmentId);
      await statusCallback("segment_end", currentSegmentText, currentSegmentId);
    }

    await statusCallback("done", "");

    return responseParts.join("") || "No response from Claude.";
  }

  /**
   * Send a message to Codex with streaming updates via callback.
   *
   * Design notes:
   * - We keep the same callback contract used by the Claude path so handlers
   *   and Telegram UX remain unchanged.
   * - Safety checks are enforced for command execution events before surfacing
   *   tool updates back to Telegram.
   */
  private async sendMessageStreamingCodex(
    message: string,
    _username: string,
    _userId: number,
    statusCallback: StatusCallback,
    chatId?: number
  ): Promise<string> {
    if (chatId) {
      process.env.TELEGRAM_CHAT_ID = String(chatId);
    }

    const isNewSession = !this.isActive;

    // Keep parity with Claude behavior so the agent has deterministic date/time
    // context on first turn without extra tool calls.
    let messageToSend = message;
    if (isNewSession) {
      const now = new Date();
      const datePrefix = `[Current date/time: ${now.toLocaleDateString(
        "en-US",
        {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        }
      )}]\n\n`;
      messageToSend = datePrefix + message;
    }

    if (this.sessionId && !isNewSession) {
      console.log(`RESUMING Codex thread ${this.sessionId.slice(0, 8)}...`);
    } else {
      console.log("STARTING new Codex thread");
      this.sessionId = null;
    }

    if (this.stopRequested) {
      console.log(
        "Query cancelled before starting (stop was requested during processing)"
      );
      this.stopRequested = false;
      throw new Error("Query cancelled");
    }

    this.abortController = null;
    this.isQueryRunning = true;
    this.stopRequested = false;
    this.queryStarted = new Date();
    this.currentTool = null;

    const responseParts: string[] = [];
    let currentSegmentId = 0;
    let currentSegmentText = "";
    let lastTextUpdate = 0;
    let textCallbackCount = 0;
    let lastEmittedTextLength = 0;

    const emitProgressiveTail = async (
      fullText: string,
      segmentId: number
    ): Promise<void> => {
      if (
        fullText.length < STREAMING_SYNTHETIC_FALLBACK_MIN_CHARS ||
        STREAMING_SYNTHETIC_STEP_CHARS <= 0
      ) {
        return;
      }

      const start = Math.max(
        lastEmittedTextLength + STREAMING_SYNTHETIC_STEP_CHARS,
        STREAMING_SYNTHETIC_STEP_CHARS
      );

      for (
        let end = start;
        end < fullText.length;
        end += STREAMING_SYNTHETIC_STEP_CHARS
      ) {
        await statusCallback("text", fullText.slice(0, end), segmentId);
        textCallbackCount++;
        lastEmittedTextLength = end;

        if (STREAMING_SYNTHETIC_STEP_DELAY_MS > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, STREAMING_SYNTHETIC_STEP_DELAY_MS)
          );
        }
      }
    };

    try {
      const codex = getCodexClient();
      const codexAdditionalDirectories = Array.from(
        new Set([WORKING_DIR, ...ALLOWED_PATHS])
      );
      console.log(
        `Codex runtime: model=${this.codexModel}, effort=${this.codexEffort}, sandbox=${CODEX_SANDBOX_MODE}, approval=${CODEX_APPROVAL_POLICY}, network=${CODEX_NETWORK_ACCESS_ENABLED}, web_search=${CODEX_WEB_SEARCH_MODE}`
      );
      let thread: {
        id: string | null;
        runStreamed: (prompt: string) => Promise<{
          events: AsyncIterable<{
            type: string;
            message?: string;
            item?: {
              type?: string;
              text?: string;
              command?: string;
            };
            error?: { message?: string };
          }>;
        }>;
      };

      if (this.sessionId && !isNewSession) {
        try {
          thread = codex.resumeThread(this.sessionId, {
            model: this.codexModel,
            modelReasoningEffort: this.codexEffort,
            sandboxMode: CODEX_SANDBOX_MODE,
            approvalPolicy: CODEX_APPROVAL_POLICY,
            networkAccessEnabled: CODEX_NETWORK_ACCESS_ENABLED,
            webSearchMode: CODEX_WEB_SEARCH_MODE,
            additionalDirectories: codexAdditionalDirectories,
            workingDirectory: WORKING_DIR,
            skipGitRepoCheck: true,
          });
        } catch (error) {
          console.warn(
            `Failed to resume Codex thread ${this.sessionId}, starting a new one: ${error}`
          );
          this.sessionId = null;
          thread = codex.startThread({
            model: this.codexModel,
            modelReasoningEffort: this.codexEffort,
            sandboxMode: CODEX_SANDBOX_MODE,
            approvalPolicy: CODEX_APPROVAL_POLICY,
            networkAccessEnabled: CODEX_NETWORK_ACCESS_ENABLED,
            webSearchMode: CODEX_WEB_SEARCH_MODE,
            additionalDirectories: codexAdditionalDirectories,
            workingDirectory: WORKING_DIR,
            skipGitRepoCheck: true,
          });
        }
      } else {
        thread = codex.startThread({
          model: this.codexModel,
          modelReasoningEffort: this.codexEffort,
          sandboxMode: CODEX_SANDBOX_MODE,
          approvalPolicy: CODEX_APPROVAL_POLICY,
          networkAccessEnabled: CODEX_NETWORK_ACCESS_ENABLED,
          webSearchMode: CODEX_WEB_SEARCH_MODE,
          additionalDirectories: codexAdditionalDirectories,
          workingDirectory: WORKING_DIR,
          skipGitRepoCheck: true,
        });
      }

      const result = await thread.runStreamed(messageToSend);

      for await (const event of result.events) {
        if (this.stopRequested) {
          console.log("Codex turn stopped by user");
          break;
        }

        if (event.type === "error") {
          const errorMessage = event.message || "Unknown Codex stream error";
          throw new Error(errorMessage);
        }

        if (event.type === "turn.failed") {
          throw new Error(event.error?.message || "Codex turn failed");
        }

        if (event.type === "item.completed") {
          const item = event.item;
          if (!item) continue;

          if (item.type === "reasoning" && item.text) {
            await statusCallback("thinking", item.text);
            continue;
          }

          if (item.type === "command_execution") {
            const command = item.command || "";
            const [isSafe, reason] = checkCommandSafety(command);
            if (!isSafe) {
              await statusCallback("tool", `BLOCKED: ${reason}`);
              throw new Error(`Unsafe command blocked: ${reason}`);
            }

            // Segment boundary before a new tool event keeps progressive edits
            // stable and mirrors the Claude experience.
            if (currentSegmentText) {
              await statusCallback(
                "segment_end",
                currentSegmentText,
                currentSegmentId
              );
              currentSegmentId++;
              currentSegmentText = "";
            }

            const toolDisplay = formatToolStatus("Bash", { command });
            this.currentTool = toolDisplay;
            this.lastTool = toolDisplay;
            await statusCallback("tool", toolDisplay);
            continue;
          }

          if (item.type === "agent_message" && item.text) {
            responseParts.push(item.text);
            currentSegmentText += item.text;

            if (
              textCallbackCount === 0 &&
              currentSegmentText.length >=
                STREAMING_SYNTHETIC_FALLBACK_MIN_CHARS
            ) {
              const firstPreviewLen = Math.max(
                1,
                Math.min(
                  STREAMING_SYNTHETIC_STEP_CHARS,
                  currentSegmentText.length - 1
                )
              );
              await statusCallback(
                "text",
                currentSegmentText.slice(0, firstPreviewLen),
                currentSegmentId
              );
              textCallbackCount++;
              lastEmittedTextLength = firstPreviewLen;
              lastTextUpdate = Date.now();
              continue;
            }

            const now = Date.now();
            const shouldEmitText =
              textCallbackCount === 0 ||
              now - lastTextUpdate >= STREAMING_THROTTLE_MS;

            if (shouldEmitText) {
              await statusCallback(
                "text",
                currentSegmentText,
                currentSegmentId
              );
              textCallbackCount++;
              lastTextUpdate = now;
              lastEmittedTextLength = currentSegmentText.length;
            }
          }
        }

        if (event.type === "turn.completed") {
          if (thread.id) {
            this.sessionId = thread.id;
            this.saveSession();
          }
          break;
        }
      }
    } catch (error) {
      const errorStr = String(error).toLowerCase();
      const isCleanupError =
        errorStr.includes("cancel") || errorStr.includes("abort");

      if (isCleanupError && this.stopRequested) {
        console.warn(`Suppressed post-stop Codex error: ${error}`);
      } else {
        console.error(`Error in Codex query: ${error}`);
        this.lastError = String(error).slice(0, 100);
        this.lastErrorTime = new Date();
        throw error;
      }
    } finally {
      this.isQueryRunning = false;
      this.abortController = null;
      this.queryStarted = null;
      this.currentTool = null;
    }

    this.lastActivity = new Date();
    this.lastError = null;
    this.lastErrorTime = null;

    if (currentSegmentText) {
      await emitProgressiveTail(currentSegmentText, currentSegmentId);
      await statusCallback("segment_end", currentSegmentText, currentSegmentId);
    }

    await statusCallback("done", "");
    return responseParts.join("") || "No response from Codex.";
  }

  /**
   * Kill the current session (clear session_id).
   */
  async kill(): Promise<void> {
    this.sessionId = null;
    this.lastActivity = null;
    this.conversationTitle = null;
    console.log("Session cleared");
  }

  /**
   * Save session to disk for resume after restart.
   * Saves to multi-session history format.
   */
  saveSession(): void {
    if (!this.sessionId) return;

    try {
      // Load existing session history
      const history = this.loadSessionHistory();

      // Create new session entry
      const newSession: SavedSession = {
        session_id: this.sessionId,
        saved_at: new Date().toISOString(),
        working_dir: WORKING_DIR,
        title: this.conversationTitle || "Sessione senza titolo",
        assistant: this.assistantMode,
        model: this.model,
        codex_reasoning_effort:
          this.assistantMode === "codex" ? this.codexEffort : undefined,
      };

      // Remove any existing entry with same session_id (update in place)
      const existingIndex = history.sessions.findIndex(
        (s) => s.session_id === this.sessionId
      );
      if (existingIndex !== -1) {
        history.sessions[existingIndex] = newSession;
      } else {
        // Add new session at the beginning
        history.sessions.unshift(newSession);
      }

      // Keep only the last MAX_SESSIONS
      history.sessions = history.sessions.slice(0, MAX_SESSIONS);

      // Save
      Bun.write(SESSION_FILE, JSON.stringify(history, null, 2));
      console.log(`Session saved to ${SESSION_FILE}`);
    } catch (error) {
      console.warn(`Failed to save session: ${error}`);
    }
  }

  /**
   * Load session history from disk.
   */
  private loadSessionHistory(): SessionHistory {
    try {
      const file = Bun.file(SESSION_FILE);
      if (!file.size) {
        return { sessions: [] };
      }

      const text = readFileSync(SESSION_FILE, "utf-8");
      return JSON.parse(text) as SessionHistory;
    } catch {
      return { sessions: [] };
    }
  }

  /**
   * Get list of saved sessions for display.
   */
  getSessionList(): SavedSession[] {
    const history = this.loadSessionHistory();
    // Filter to only sessions for current working directory
    return history.sessions.filter(
      (s) => !s.working_dir || s.working_dir === WORKING_DIR
    );
  }

  /**
   * Resume a specific session by ID.
   */
  resumeSession(sessionId: string): [success: boolean, message: string] {
    const history = this.loadSessionHistory();
    const sessionData = history.sessions.find((s) => s.session_id === sessionId);

    if (!sessionData) {
      return [false, "Sessione non trovata"];
    }

    if (sessionData.working_dir && sessionData.working_dir !== WORKING_DIR) {
      return [
        false,
        `Sessione per directory diversa: ${sessionData.working_dir}`,
      ];
    }

    this.sessionId = sessionData.session_id;
    this.conversationTitle = sessionData.title;
    this.lastActivity = new Date();
    if (sessionData.assistant) {
      this.assistantMode = sessionData.assistant;
    }
    if (sessionData.model) {
      if (this.assistantMode === "codex") {
        this.codexModel = sessionData.model;
        if (sessionData.codex_reasoning_effort) {
          this.codexEffort = sessionData.codex_reasoning_effort;
        }
      } else {
        this.claudeModel = sessionData.model;
      }
    }

    console.log(
      `Resumed session ${sessionData.session_id.slice(0, 8)}... - "${sessionData.title}"`
    );

    return [
      true,
      `Ripresa sessione: "${sessionData.title}"`,
    ];
  }

  /**
   * Resume the last persisted session (legacy method, now resumes most recent).
   */
  resumeLast(): [success: boolean, message: string] {
    const sessions = this.getSessionList();
    if (sessions.length === 0) {
      return [false, "Nessuna sessione salvata"];
    }

    return this.resumeSession(sessions[0]!.session_id);
  }
}

// Global session instance
export const session = new ClaudeSession();
