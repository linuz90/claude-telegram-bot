/**
 * Session management for Claude Telegram Bot.
 *
 * ClaudeSession class manages Claude Code sessions using the Agent SDK V1.
 * V1 supports full options (cwd, mcpServers, settingSources, etc.)
 */

import {
  query,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import OpenAI from "openai";
import { readFileSync } from "fs";
import type { Context } from "grammy";
import {
  ALLOWED_PATHS,
  CLAUDE_CLI_PATH,
  MCP_SERVERS,
  QUERY_TIMEOUT_MS,
  SAFETY_PROMPT,
  SESSION_FILE,
  STREAMING_THROTTLE_MS,
  TEMP_PATHS,
  THINKING_DEEP_KEYWORDS,
  THINKING_KEYWORDS,
  WORKING_DIR,
} from "./config";
import { formatToolStatus } from "./formatting";
import {
  checkPendingAskUserRequests,
  checkPendingSendFileRequests,
} from "./handlers/streaming";
import {
  getActiveLlmProvider,
  getLlmProviderConfig,
} from "./llm-provider";
import { nativeToolRuntime } from "./native-tool-runtime";
import { responseLanguageInstruction, t } from "./i18n";
import { checkCommandSafety, isPathAllowed } from "./security";
import type {
  CliProviderConfig,
  OpenAIChatProviderConfig,
  SavedSession,
  SessionHistory,
  StatusCallback,
  TokenUsage,
} from "./types";

/**
 * Determine thinking token budget based on message keywords.
 */
function getThinkingLevel(message: string): number {
  const msgLower = message.toLowerCase();

  // Check deep thinking triggers first (more specific)
  if (THINKING_DEEP_KEYWORDS.some((k) => msgLower.includes(k))) {
    return 50000;
  }

  // Check normal thinking triggers
  if (THINKING_KEYWORDS.some((k) => msgLower.includes(k))) {
    return 10000;
  }

  // Default: no thinking
  return 0;
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
const OPENAI_SYSTEM_PROMPT = `You are the Telegram bot's fallback LLM.
${responseLanguageInstruction()}
When tools are available, use them before answering questions about configured MCP data, saved memory, files, terminal, or recent Telegram context.
For general explanations, planning, drafting, and Q&A, answer normally and concisely.
Working directory context: ${WORKING_DIR}`;

interface CliToolRequest {
  tool: string;
  arguments?: Record<string, unknown>;
}

function parseCliToolRequest(output: string): CliToolRequest | null {
  const trimmed = output.trim();
  const jsonText =
    trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1] ||
    trimmed.match(/(\{[\s\S]*"tool"[\s\S]*\})/)?.[1] ||
    trimmed;
  try {
    const parsed = JSON.parse(jsonText) as Partial<CliToolRequest>;
    if (typeof parsed.tool === "string") {
      return {
        tool: parsed.tool,
        arguments:
          parsed.arguments && typeof parsed.arguments === "object"
            ? parsed.arguments as Record<string, unknown>
            : {},
      };
    }
  } catch {
    return null;
  }
  return null;
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
    if (chatId) {
      process.env.TELEGRAM_CHAT_ID = String(chatId);
    }

    const provider = getActiveLlmProvider();
    const providerConfig = getLlmProviderConfig(provider);
    if (providerConfig.type === "openai-chat") {
      return this.sendOpenAIStreaming(
        message,
        statusCallback,
        providerConfig
      );
    }
    if (providerConfig.type === "cli") {
      return this.sendCliProvider(
        message,
        statusCallback,
        provider,
        providerConfig
      );
    }

    const isNewSession = !this.isActive;
    const thinkingTokens = getThinkingLevel(message);
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
      model: "claude-sonnet-4-5",
      cwd: WORKING_DIR,
      settingSources: ["user", "project"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      systemPrompt: SAFETY_PROMPT,
      mcpServers: MCP_SERVERS,
      maxThinkingTokens: thinkingTokens,
      additionalDirectories: ALLOWED_PATHS,
      resume: this.sessionId || undefined,
    };

    // Use the configured Claude Code executable instead of the SDK bundled CLI.
    // The bundled CLI can lag behind the user's installed Claude Code version.
    options.pathToClaudeCodeExecutable =
      process.env.CLAUDE_CODE_PATH || CLAUDE_CLI_PATH;

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
    let timedOut = false;
    const queryTimeout = setTimeout(() => {
      timedOut = true;
      console.warn(`Query timed out after ${QUERY_TIMEOUT_MS}ms`);
      this.abortController?.abort();
    }, QUERY_TIMEOUT_MS);

    // Response tracking
    const responseParts: string[] = [];
    let currentSegmentId = 0;
    let currentSegmentText = "";
    let lastTextUpdate = 0;
    let queryCompleted = false;
    let askUserTriggered = false;

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

              // Don't show tool status for ask_user/send_file - they handle their own UI
              if (
                !toolName.startsWith("mcp__ask-user") &&
                !toolName.startsWith("mcp__send-file")
              ) {
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

              // Send file to user after send-file MCP tool (fire-and-forget)
              if (toolName.startsWith("mcp__send-file") && ctx && chatId) {
                await new Promise((resolve) => setTimeout(resolve, 200));
                for (let attempt = 0; attempt < 3; attempt++) {
                  const sent = await checkPendingSendFileRequests(ctx, chatId);
                  if (sent) break;
                  if (attempt < 2) {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                  }
                }
                // NO break — Claude continues generating
              }
            }

            // Text content
            if (block.type === "text") {
              responseParts.push(block.text);
              currentSegmentText += block.text;

              // Stream text updates (throttled)
              const now = Date.now();
              if (
                now - lastTextUpdate > STREAMING_THROTTLE_MS &&
                currentSegmentText.length > 20
              ) {
                await statusCallback(
                  "text",
                  currentSegmentText,
                  currentSegmentId
                );
                lastTextUpdate = now;
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
          if (
            "subtype" in event &&
            event.subtype === "error_during_execution"
          ) {
            const errors = "errors" in event ? event.errors : undefined;
            const detail = Array.isArray(errors) && errors.length > 0
              ? String(errors[0])
              : "Claude Code execution failed";
            throw new Error(detail);
          }

          console.log("Response complete");
          queryCompleted = true;

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

      if (timedOut) {
        this.lastError = "Query timed out";
        this.lastErrorTime = new Date();
        throw new Error("Query timed out");
      }

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
      clearTimeout(queryTimeout);
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
      await statusCallback("segment_end", currentSegmentText, currentSegmentId);
    }

    await statusCallback("done", "");

    if (responseParts.length === 0) {
      await statusCallback("text", "No response from Claude.", currentSegmentId);
      await statusCallback(
        "segment_end",
        "No response from Claude.",
        currentSegmentId
      );
      return "No response from Claude.";
    }

    return responseParts.join("");
  }

  private async sendOpenAIStreaming(
    message: string,
    statusCallback: StatusCallback,
    providerConfig: OpenAIChatProviderConfig
  ): Promise<string> {
    const apiKeyEnv = providerConfig.apiKeyEnv || "OPENAI_API_KEY";
    const apiKey = process.env[apiKeyEnv] || "";
    if (!apiKey) {
      throw new Error(
        `${providerConfig.label || "OpenAI"} provider selected but ${apiKeyEnv} is not configured.`
      );
    }

    const isNewSession = !this.lastActivity;
    let messageToSend = message;
    if (isNewSession) {
      const now = new Date();
      messageToSend = `[Current date/time: ${now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })}]\n\n${message}`;
    }

    console.log(
      `STARTING OpenAI-compatible fallback (${providerConfig.model})`
    );

    if (this.stopRequested) {
      this.stopRequested = false;
      throw new Error("Query cancelled");
    }

    this.abortController = new AbortController();
    this.isQueryRunning = true;
    this.stopRequested = false;
    this.queryStarted = new Date();
    this.currentTool = `LLM: ${providerConfig.label || providerConfig.model}`;
    this.lastTool = this.currentTool;

    let timedOut = false;
    const queryTimeout = setTimeout(() => {
      timedOut = true;
      console.warn(`OpenAI query timed out after ${QUERY_TIMEOUT_MS}ms`);
      this.abortController?.abort();
    }, QUERY_TIMEOUT_MS);

    const responseParts: string[] = [];
    let currentSegmentText = "";

    try {
      await statusCallback("tool", this.currentTool);

      const client = new OpenAI({
        apiKey,
        baseURL: providerConfig.baseURL,
      });

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: OPENAI_SYSTEM_PROMPT },
        { role: "user", content: messageToSend },
      ];
      const nativeTools = providerConfig.tools
        ? await nativeToolRuntime.listTools()
        : [];
      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] =
        nativeTools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        }));

      for (let step = 0; step < 6; step++) {
        if (this.stopRequested) {
          console.log("OpenAI query aborted by user");
          break;
        }

        const completion = await client.chat.completions.create(
          {
            model: providerConfig.model,
            messages,
            tools: tools.length ? tools : undefined,
            tool_choice: tools.length ? "auto" : undefined,
          },
          { signal: this.abortController.signal }
        );

        const usage = completion.usage;
        if (usage) {
          this.lastUsage = {
            input_tokens: usage.prompt_tokens || 0,
            output_tokens: usage.completion_tokens || 0,
          };
        }

        const choice = completion.choices[0];
        const assistantMessage = choice?.message;
        if (!assistantMessage) {
          break;
        }

        messages.push(assistantMessage);
        const toolCalls = assistantMessage.tool_calls || [];
        if (!toolCalls.length) {
          const content = assistantMessage.content || "";
          if (content) {
            responseParts.push(content);
            currentSegmentText += content;
            await statusCallback("text", currentSegmentText, 0);
          }
          break;
        }

        for (const toolCall of toolCalls) {
          if (toolCall.type !== "function") {
            continue;
          }
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments || "{}") as Record<
              string,
              unknown
            >;
          } catch {
            args = {};
          }
          const result = await nativeToolRuntime.callTool(
            toolCall.function.name,
            args,
            statusCallback,
            {
              provider: getActiveLlmProvider(),
              override: providerConfig.toolPolicy,
            }
          );
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });
        }
      }
    } catch (error) {
      if (timedOut) {
        this.lastError = "OpenAI query timed out";
        this.lastErrorTime = new Date();
        throw new Error("OpenAI query timed out");
      }

      const errorStr = String(error).toLowerCase();
      if (errorStr.includes("abort") || errorStr.includes("cancel")) {
        throw error;
      }

      console.error(`Error in OpenAI query: ${error}`);
      this.lastError = String(error).slice(0, 100);
      this.lastErrorTime = new Date();
      throw error;
    } finally {
      clearTimeout(queryTimeout);
      this.isQueryRunning = false;
      this.abortController = null;
      this.queryStarted = null;
      this.currentTool = null;
    }

    this.lastActivity = new Date();
    this.lastError = null;
    this.lastErrorTime = null;

    if (currentSegmentText) {
      await statusCallback("segment_end", currentSegmentText, 0);
    }
    await statusCallback("done", "");

    if (responseParts.length === 0) {
      const fallback = "OpenAI provider returned no response.";
      await statusCallback("text", fallback, 0);
      await statusCallback("segment_end", fallback, 0);
      return fallback;
    }

    console.log("OpenAI-compatible response complete");
    return responseParts.join("");
  }

  private async sendCliProvider(
    message: string,
    statusCallback: StatusCallback,
    provider: string,
    providerConfig: CliProviderConfig
  ): Promise<string> {
    const timeoutMs = providerConfig.timeoutMs || QUERY_TIMEOUT_MS;

    console.log(`STARTING CLI provider ${provider}: ${providerConfig.command}`);

    if (this.stopRequested) {
      this.stopRequested = false;
      throw new Error("Query cancelled");
    }

    this.abortController = new AbortController();
    this.isQueryRunning = true;
    this.stopRequested = false;
    this.queryStarted = new Date();
    this.currentTool = `LLM: ${providerConfig.label || provider}`;
    this.lastTool = this.currentTool;

    let timedOut = false;
    const queryTimeout = setTimeout(() => {
      timedOut = true;
      console.warn(`CLI provider ${provider} timed out after ${timeoutMs}ms`);
      this.abortController?.abort();
    }, timeoutMs);

    const responseParts: string[] = [];

    try {
      await statusCallback("tool", this.currentTool);
      const nativeTools = providerConfig.tools
        ? await nativeToolRuntime.listTools()
        : [];
      let prompt = message;

      if (nativeTools.length) {
        prompt = `${OPENAI_SYSTEM_PROMPT}

Available tools:
${nativeTools
  .map(
    (tool) =>
      `- ${tool.name}: ${tool.description || ""}\n  input_schema: ${JSON.stringify(tool.inputSchema)}`
  )
  .join("\n")}

If you need a tool, reply ONLY with JSON in this exact shape:
{"tool":"tool_name","arguments":{...}}

After tool results are provided, answer normally. ${responseLanguageInstruction()}

User message:
${message}`;
      }

      for (let step = 0; step < 6; step++) {
        const output = await this.runCliOnce(
          prompt,
          provider,
          providerConfig
        );
        const toolRequest = nativeTools.length
          ? parseCliToolRequest(output)
          : null;

        if (!toolRequest) {
          if (output) {
            responseParts.push(output);
            await statusCallback("text", output, 0);
            await statusCallback("segment_end", output, 0);
          }
          break;
        }

        const result = await nativeToolRuntime.callTool(
          toolRequest.tool,
          toolRequest.arguments || {},
          statusCallback,
          {
            provider,
            override: providerConfig.toolPolicy,
          }
        );
        prompt = `${prompt}

Tool result for ${toolRequest.tool}:
${result}

Now either call another tool with the same JSON-only format, or provide the final answer. ${responseLanguageInstruction()}`;
      }
    } catch (error) {
      if (timedOut) {
        this.lastError = `${provider} timed out`;
        this.lastErrorTime = new Date();
        throw new Error(`${provider} timed out`);
      }

      const errorStr = String(error).toLowerCase();
      if (errorStr.includes("abort") || errorStr.includes("cancel")) {
        throw error;
      }

      console.error(`Error in CLI provider ${provider}: ${error}`);
      this.lastError = String(error).slice(0, 100);
      this.lastErrorTime = new Date();
      throw error;
    } finally {
      clearTimeout(queryTimeout);
      this.isQueryRunning = false;
      this.abortController = null;
      this.queryStarted = null;
      this.currentTool = null;
    }

    this.lastActivity = new Date();
    this.lastError = null;
    this.lastErrorTime = null;
    await statusCallback("done", "");

    if (responseParts.length === 0) {
      const fallback = `${providerConfig.label || provider} returned no response.`;
      await statusCallback("text", fallback, 0);
      await statusCallback("segment_end", fallback, 0);
      return fallback;
    }

    return responseParts.join("\n");
  }

  private async runCliOnce(
    prompt: string,
    provider: string,
    providerConfig: CliProviderConfig
  ): Promise<string> {
    const args = [...(providerConfig.args || [])];
    if ((providerConfig.promptMode || "stdin") === "arg-last") {
      args.push(prompt);
    }

    const proc = Bun.spawn([providerConfig.command, ...args], {
      cwd: providerConfig.cwd || WORKING_DIR,
      env: {
        ...process.env,
        ...(providerConfig.env || {}),
      },
      stdin: (providerConfig.promptMode || "stdin") === "stdin"
        ? "pipe"
        : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: this.abortController?.signal,
    });

    if ((providerConfig.promptMode || "stdin") === "stdin") {
      const stdin = proc.stdin;
      if (!stdin) {
        throw new Error(`${providerConfig.label || provider} stdin is unavailable`);
      }
      stdin.write(prompt);
      stdin.end();
    }

    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const [stdout, stderr] = await Promise.all([
      stdoutPromise,
      stderrPromise,
    ]);

    if (this.stopRequested) {
      throw new Error("Query cancelled");
    }

    if (exitCode !== 0) {
      throw new Error(
        `${providerConfig.label || provider} exited with code ${exitCode}: ${stderr.slice(0, 500)}`
      );
    }

    return (stdout.trim() || stderr.trim()).trim();
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
        title: this.conversationTitle || t.defaultSessionTitle,
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
      return [false, t.sessionNotFound];
    }

    if (sessionData.working_dir && sessionData.working_dir !== WORKING_DIR) {
      return [
        false,
        t.sessionDifferentDirectory(sessionData.working_dir),
      ];
    }

    this.sessionId = sessionData.session_id;
    this.conversationTitle = sessionData.title;
    this.lastActivity = new Date();

    console.log(
      `Resumed session ${sessionData.session_id.slice(0, 8)}... - "${sessionData.title}"`
    );

    return [
      true,
      t.sessionResumed(sessionData.title),
    ];
  }

  /**
   * Resume the last persisted session (legacy method, now resumes most recent).
   */
  resumeLast(): [success: boolean, message: string] {
    const sessions = this.getSessionList();
    if (sessions.length === 0) {
      return [false, t.noSavedSessions];
    }

    return this.resumeSession(sessions[0]!.session_id);
  }
}

// Global session instance
export const session = new ClaudeSession();
