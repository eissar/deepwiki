import { ServerError } from "./errors.js";

const MCP_ENDPOINT = "https://mcp.deepwiki.com/mcp";

/** Abort if the server sends nothing (no bytes at all) for this long. */
const IDLE_TIMEOUT_MS = 60_000;

/** Max chars of raw payload included in error messages. */
const RAW_LIMIT = 2_000;

export type ProgressFn = (message: string) => void;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

let requestId = 0;

function clip(s: string): string {
  return s.length > RAW_LIMIT ? `${s.slice(0, RAW_LIMIT)}… [${s.length - RAW_LIMIT} more chars]` : s;
}

function fail(reason: string, raw?: unknown): never {
  const rawStr = raw === undefined ? "" : typeof raw === "string" ? raw : JSON.stringify(raw);
  throw new ServerError(rawStr ? `${reason}\n--- raw ---\n${clip(rawStr)}` : reason);
}

function parseJson(text: string, where: string): JsonRpcMessage {
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`Malformed JSON in ${where}: ${(err as Error).message}`, text);
  }
}

/**
 * Handle one JSON-RPC message. Returns the message if it is the response to
 * `id`; returns undefined for notifications; throws on anything else.
 */
function route(msg: JsonRpcMessage, id: number, onProgress?: ProgressFn): JsonRpcMessage | undefined {
  if (msg.method !== undefined && msg.id === undefined) {
    if (msg.method === "notifications/message" || msg.method === "notifications/progress") {
      const text = msg.params?.data?.msg ?? msg.params?.message;
      if (typeof text === "string") onProgress?.(text);
      return undefined;
    }
    fail(`Unhandled server notification '${msg.method}'`, msg);
  }
  if (msg.method !== undefined) {
    fail(`Server sent a request ('${msg.method}'); this client does not handle server->client requests`, msg);
  }
  if (msg.id !== id) {
    fail(`Response id mismatch: expected ${id}, got ${JSON.stringify(msg.id)}`, msg);
  }
  return msg;
}

/** Incremental SSE parser per the WHATWG spec (data-only; we ignore event/id/retry). */
async function readSse(
  res: Response,
  id: number,
  resetIdle: () => void,
  onProgress?: ProgressFn,
): Promise<JsonRpcMessage> {
  if (!res.body) fail("SSE response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let data: string[] = [];
  let seenAny = false;

  const dispatch = (): JsonRpcMessage | undefined => {
    if (data.length === 0) return undefined;
    const payload = data.join("\n");
    data = [];
    seenAny = true;
    return route(parseJson(payload, "SSE event"), id, onProgress);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (value) {
      resetIdle();
      buf += decoder.decode(value, { stream: true });
    }
    if (done) buf += "\n\n"; // flush trailing event

    let nl: number;
    while ((nl = buf.search(/\r\n|\r|\n/)) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + (buf.startsWith("\r\n", nl) ? 2 : 1));
      if (line === "") {
        const msg = dispatch();
        if (msg) {
          reader.cancel().catch(() => {});
          return msg;
        }
        continue;
      }
      if (line.startsWith(":")) continue; // comment / keepalive
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let val = colon === -1 ? "" : line.slice(colon + 1);
      if (val.startsWith(" ")) val = val.slice(1);
      if (field === "data") data.push(val);
    }

    if (done) {
      fail(seenAny
        ? `SSE stream ended without a response for request id ${id}`
        : "SSE stream ended without any events");
    }
  }
}

function extractText(result: any, isError: boolean): string {
  const content = result?.content;
  if (!Array.isArray(content) || content.length === 0) {
    fail(`${isError ? "Tool error" : "Tool result"} has no content`, result);
  }
  const nonText = content.filter((c: any) => c?.type !== "text" || typeof c.text !== "string");
  if (nonText.length > 0) {
    fail(`${isError ? "Tool error" : "Tool result"} contains non-text content`, result);
  }
  const text = content.map((c: any) => c.text).join("\n");
  if (text.trim() === "") {
    fail(`${isError ? "Tool error" : "Tool result"} text is empty`, result);
  }
  return text;
}

async function callMcp(
  toolName: string,
  args: Record<string, unknown>,
  onProgress?: ProgressFn,
): Promise<string> {
  const id = ++requestId;
  const body = { jsonrpc: "2.0", method: "tools/call", params: { name: toolName, arguments: args }, id };

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };
  resetIdle();

  try {
    let res: Response;
    try {
      res = await fetch(MCP_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw describeFetchError(err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      fail(`DeepWiki server returned HTTP ${res.status} ${res.statusText}`, text || undefined);
    }

    const contentType = res.headers.get("content-type") || "";
    let rpc: JsonRpcMessage;
    try {
      if (contentType.includes("text/event-stream")) {
        rpc = await readSse(res, id, resetIdle, onProgress);
      } else if (contentType.includes("application/json")) {
        const msg = route(parseJson(await res.text(), "JSON response"), id, onProgress);
        if (!msg) fail("JSON response was a notification, not a response");
        rpc = msg;
      } else {
        fail(`Unexpected content-type '${contentType}'`, await res.text().catch(() => ""));
      }
    } catch (err) {
      if (err instanceof ServerError) throw err;
      throw describeFetchError(err);
    }

    if (rpc.error) {
      fail(`MCP error ${rpc.error.code}: ${rpc.error.message}`, rpc.error.data);
    }
    if (rpc.result === undefined || rpc.result === null) {
      fail("Response has neither 'result' nor 'error'", rpc);
    }
    if (rpc.result.isError) {
      throw new ServerError(extractText(rpc.result, true));
    }
    return extractText(rpc.result, false);
  } finally {
    clearTimeout(timeoutId);
  }
}

function describeFetchError(err: unknown): ServerError {
  if (err instanceof Error && err.name === "AbortError") {
    return new ServerError(`Request aborted: no data from server for ${IDLE_TIMEOUT_MS / 1000}s`);
  }
  if (err instanceof Error) {
    const cause = (err as any).cause;
    const causeStr = cause ? ` (cause: ${cause.code ?? ""} ${cause.message ?? String(cause)})`.replace("  ", " ") : "";
    return new ServerError(`Network error: ${err.message}${causeStr}`);
  }
  return new ServerError(`Network error: ${String(err)}`);
}

export async function readWikiStructure(repoName: string, onProgress?: ProgressFn): Promise<string> {
  return callMcp("read_wiki_structure", { repoName }, onProgress);
}

export async function readWikiContents(repoName: string, onProgress?: ProgressFn): Promise<string> {
  return callMcp("read_wiki_contents", { repoName }, onProgress);
}

export async function askQuestion(
  repoNames: string[],
  question: string,
  onProgress?: ProgressFn,
): Promise<string> {
  const repoName = repoNames.length === 1 ? repoNames[0] : repoNames;
  return callMcp("ask_wiki_question", { repoName, question }, onProgress);
}
