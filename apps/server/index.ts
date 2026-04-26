import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import path from "node:path";
import process from "node:process";

import {
  describeError,
  formatErrorWithContext,
} from "../../bot/core/errors.js";
import { loadDocs } from "../../bot/core/loadDocs.js";
import { buildSystem } from "../../bot/core/systemPrompt.js";
import { getOrCreateSession, resetSession } from "./sessions.js";
import { closeSseStream, openSseStream, writeSseEvent } from "./sseRelay.js";

// Server config: port comes from env so deployments can override; paths are
// resolved from cwd (the repo root) so the same code works under tsx (dev)
// and under node on the compiled dist/ (prod).
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const DOCS_DIRECTORY = path.resolve(process.cwd(), "bot", "docs");
const CLIENT_DIST_DIR = path.resolve(process.cwd(), "apps", "web", "dist");

// MIME map for the static-file fallback. We only ship a handful of asset
// kinds, so a tiny lookup table beats pulling in `mime-types`.
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

// Read JSON body from a request stream. Throws if the body is not valid JSON.
const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
};

// Tiny helper: send a plain JSON response with a status code.
const sendJson = (
  res: ServerResponse,
  status: number,
  payload: unknown,
): void => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
};

// Validate the body of POST /api/chat and pull out the fields we care about.
// Returns null + writes a 400 if the body is malformed.
interface ChatRequestBody {
  sessionId: string;
  message: string;
}
const parseChatRequest = (
  body: unknown,
  res: ServerResponse,
): ChatRequestBody | null => {
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as ChatRequestBody).sessionId !== "string" ||
    typeof (body as ChatRequestBody).message !== "string"
  ) {
    sendJson(res, 400, {
      error: "Body must be { sessionId: string, message: string }.",
    });
    return null;
  }
  return body as ChatRequestBody;
};

// ---------------------------------------------------------------------------
// boot: load docs once, then start the http server
// ---------------------------------------------------------------------------

const bootDeps = async () => {
  try {
    const docs = await loadDocs(DOCS_DIRECTORY);
    const system = buildSystem();
    console.log(
      `[boot] Loaded ${docs.files.length} doc file(s), ~${docs.tokensApprox} tokens.`,
    );
    return { docs, system };
  } catch (error) {
    console.error(formatErrorWithContext("boot", error));
    process.exit(1);
  }
};

const deps = await bootDeps();

// ---------------------------------------------------------------------------
// route handlers
// ---------------------------------------------------------------------------

// POST /api/chat - opens an SSE stream, runs ask(), relays text chunks.
const handleChat = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: `Invalid JSON body: ${describeError(error)}` });
    return;
  }

  const parsed = parseChatRequest(body, res);
  if (!parsed) return;

  const session = getOrCreateSession(parsed.sessionId, deps);

  openSseStream(res);

  // If the client disconnects mid-stream we still want to consume the model
  // response (so history stays consistent), but we stop writing to the socket.
  let clientStillConnected = true;
  req.on("close", () => {
    clientStillConnected = false;
  });

  try {
    const result = await session.ask(parsed.message, {
      onText: (chunk) => {
        if (clientStillConnected) writeSseEvent(res, "chunk", { text: chunk });
      },
    });
    writeSseEvent(res, "done", {
      usage: result.usage,
      kind: result.kind,
      topic: result.topic,
    });
  } catch (error) {
    const message = describeError(error);
    console.error(formatErrorWithContext("chat", error));
    writeSseEvent(res, "error", { message });
  } finally {
    closeSseStream(res);
  }
};

// POST /api/reset - clears the session's history.
const handleReset = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: `Invalid JSON body: ${describeError(error)}` });
    return;
  }

  const sessionId = (body as { sessionId?: unknown })?.sessionId;
  if (typeof sessionId !== "string") {
    sendJson(res, 400, { error: "Body must be { sessionId: string }." });
    return;
  }

  resetSession(sessionId);
  res.writeHead(204);
  res.end();
};

// GET /* - static file serving for the built client.
// Falls back to index.html so client-side routes (we have none yet, but it
// is cheap to support) keep working.
const handleStatic = async (
  reqUrl: string,
  res: ServerResponse,
): Promise<void> => {
  // Strip query string and decode URI-escapes before joining with disk path.
  const urlPath = decodeURIComponent(reqUrl.split("?")[0] ?? "/");
  const safePath = urlPath.replace(/\.\./g, ""); // crude path-traversal guard
  const candidate =
    safePath === "/" ? "index.html" : safePath.replace(/^\//, "");
  const fullPath = path.join(CLIENT_DIST_DIR, candidate);

  try {
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const extension = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
    });
    createReadStream(fullPath).pipe(res);
  } catch {
    // Fallback to index.html for unknown routes (SPA-friendly).
    const indexPath = path.join(CLIENT_DIST_DIR, "index.html");
    try {
      await stat(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      createReadStream(indexPath).pipe(res);
    } catch {
      sendJson(res, 404, {
        error:
          "Client bundle not found. Run `npm run build:web` first, or use `npm run dev:web` for development.",
      });
    }
  }
};

// ---------------------------------------------------------------------------
// http server
// ---------------------------------------------------------------------------

const httpServer = http.createServer((req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // Permissive CORS for local dev so vite (5173) can call this server (3000).
  // In production we serve client and api from the same origin so this is
  // effectively a no-op.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === "POST" && url === "/api/chat") {
    handleChat(req, res).catch((error: unknown) => {
      console.error(formatErrorWithContext("route:chat", error));
    });
    return;
  }

  if (method === "POST" && url === "/api/reset") {
    handleReset(req, res).catch((error: unknown) => {
      console.error(formatErrorWithContext("route:reset", error));
    });
    return;
  }

  if (method === "GET") {
    handleStatic(url, res).catch((error: unknown) => {
      console.error(formatErrorWithContext("route:static", error));
    });
    return;
  }

  sendJson(res, 404, { error: `No route for ${method} ${url}` });
});

httpServer.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});

// Graceful shutdown so `node --watch` restarts cleanly.
const shutdown = (signal: string) => {
  console.log(`[server] Received ${signal}, shutting down.`);
  httpServer.close(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
