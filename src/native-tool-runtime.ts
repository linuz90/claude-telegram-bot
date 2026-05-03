/**
 * Provider-independent tool runtime.
 *
 * This talks to configured MCP servers directly, without going through Claude
 * Code. LLM providers can use it through their own tool-calling adapters.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCP_SERVERS, WORKING_DIR } from "./config";
import type { McpServerConfig, StatusCallback, ToolPolicyConfig } from "./types";
import { evaluateToolPolicy } from "./tool-policy";

export interface NativeTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface NativeToolMetadata extends NativeTool {
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

interface ToolBinding {
  serverId: string;
  toolName: string;
  metadata: NativeToolMetadata;
}

interface RuntimeConnection {
  client: Client;
  transport: { close?: () => Promise<void> };
}

function normalizeToolName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function formatToolResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return String(result ?? "");
  }

  if ("toolResult" in result) {
    return JSON.stringify(result.toolResult, null, 2);
  }

  const maybeResult = result as {
    content?: Array<
      | { type: "text"; text: string }
      | { type: "resource"; resource: { text?: string; blob?: string; uri: string } }
      | { type: string; [key: string]: unknown }
    >;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };

  const parts: string[] = [];
  if (maybeResult.structuredContent) {
    parts.push(JSON.stringify(maybeResult.structuredContent, null, 2));
  }

  for (const block of maybeResult.content || []) {
    if (block.type === "text") {
      parts.push(String(block.text || ""));
    } else if (block.type === "resource") {
      const resource = block.resource as {
        text?: unknown;
        blob?: unknown;
        uri?: unknown;
      };
      parts.push(
        typeof resource.text === "string"
          ? resource.text
          : `[resource: ${String(resource.uri || "unknown")}]`
      );
    } else {
      parts.push(JSON.stringify(block));
    }
  }

  const text = parts.filter(Boolean).join("\n");
  return maybeResult.isError ? `ERROR: ${text}` : text;
}

class NativeToolRuntime {
  private connections = new Map<string, RuntimeConnection>();
  private tools: NativeToolMetadata[] | null = null;
  private bindings = new Map<string, ToolBinding>();

  async listTools(): Promise<NativeToolMetadata[]> {
    if (this.tools) {
      return this.tools;
    }

    const tools: NativeToolMetadata[] = [];
    this.bindings.clear();

    for (const [serverId, config] of Object.entries(MCP_SERVERS)) {
      try {
        const client = await this.getClient(serverId, config);
        const result = await client.listTools();
        for (const tool of result.tools) {
          const exposedName = `${normalizeToolName(serverId)}__${normalizeToolName(tool.name)}`;
          const metadata: NativeToolMetadata = {
            name: exposedName,
            description: tool.description || `${serverId}: ${tool.name}`,
            inputSchema: tool.inputSchema as Record<string, unknown>,
            annotations: tool.annotations,
          };
          this.bindings.set(exposedName, {
            serverId,
            toolName: tool.name,
            metadata,
          });
          tools.push(metadata);
        }
      } catch (error) {
        console.warn(`Failed to list MCP tools for ${serverId}: ${error}`);
      }
    }

    this.tools = tools;
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    statusCallback?: StatusCallback,
    policyContext?: {
      provider: string;
      override?: Partial<ToolPolicyConfig>;
    }
  ): Promise<string> {
    const binding = this.bindings.get(name);
    if (!binding) {
      await this.listTools();
    }

    const resolved = this.bindings.get(name);
    if (!resolved) {
      throw new Error(`Unknown native tool: ${name}`);
    }

    const provider = policyContext?.provider || "unknown";
    const policy = evaluateToolPolicy(
      provider,
      resolved.metadata,
      policyContext?.override
    );
    console.log(
      `Native tool policy: provider=${provider} tool=${name} risk=${policy.risk} decision=${policy.decision}`
    );

    if (policy.decision !== "allow") {
      await statusCallback?.(
        "tool",
        `BLOCKED: ${resolved.serverId}: ${resolved.toolName} (${policy.reason})`
      );
      throw new Error(`Tool blocked: ${policy.reason}`);
    }

    await statusCallback?.("tool", `🔧 ${resolved.serverId}: ${resolved.toolName}`);
    const config = MCP_SERVERS[resolved.serverId];
    if (!config) {
      throw new Error(`MCP server not configured: ${resolved.serverId}`);
    }

    const client = await this.getClient(resolved.serverId, config);
    const result = await client.callTool(
      {
        name: resolved.toolName,
        arguments: args,
      },
      CallToolResultSchema
    );
    return formatToolResult(result);
  }

  async closeAll(): Promise<void> {
    const connections = [...this.connections.values()];
    this.connections.clear();
    this.tools = null;
    this.bindings.clear();
    await Promise.allSettled(
      connections.map((connection) => connection.transport.close?.())
    );
  }

  private async getClient(
    serverId: string,
    config: McpServerConfig
  ): Promise<Client> {
    const existing = this.connections.get(serverId);
    if (existing) {
      return existing.client;
    }

    const client = new Client({
      name: "telegram-bot-native-tool-runtime",
      version: "1.0.0",
    });

    const transport = this.createTransport(config);

    await client.connect(transport);
    this.connections.set(serverId, { client, transport });
    return client;
  }

  private createTransport(config: McpServerConfig) {
    if ("type" in config && config.type === "http") {
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: {
          headers: config.headers,
        },
      });
    }

    if (!("command" in config)) {
      throw new Error("Invalid stdio MCP server config");
    }

    return new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      cwd: WORKING_DIR,
      env: {
        ...process.env,
        ...(config.env || {}),
      } as Record<string, string>,
      stderr: "pipe",
    });
  }
}

export const nativeToolRuntime = new NativeToolRuntime();
