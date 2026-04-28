import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import path from "node:path";
import process from "node:process";

import type { ViteDevServer } from "vite";

import {
  describeError,
  formatErrorWithContext,
} from "../../bot/core/errors.js";
import { loadDocs } from "../../bot/core/loadDocs.js";
import { buildSystem } from "../../bot/core/systemPrompt.js";
import { getOrCreateSession, resetSession } from "./sessions.js";
import { closeSseStream, openSseStream, writeSseEvent } from "./sseRelay.js";

// Port comes from env so deployments can override without touching the code.
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const DOCS_DIRECTORY = path.resolve(process.cwd(), "bot", "docs");
const CLIENT_DIST_DIR = path.resolve(process.cwd(), "apps", "web", "dist");
const VITE_CONFIG_PATH = path.resolve(
  process.cwd(),
  "apps",
  "web",
  "vite.config.ts",
);

// Dev detection without NODE_ENV: in dev this file is loaded as .ts via tsx;
// in prod it lives inside dist/. Cross-platform safe, no env var needed.
const IS_DEV = !import.meta.url.includes("/dist/");

// MIME map for static-file serving. A tiny lookup beats pulling in `mime-types`.
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

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

// Read all chunks from the request stream and JSON-parse them.
const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
};

const sendJson = (
  response: ServerResponse,
  status: number,
  payload: unknown,
): void => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
};

// Read and parse the JSON body, sending a 400 and returning null on any failure.
// Shared by handleChat and handleReset to avoid duplicating the try/catch.
const readJsonBodyOrReject = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<unknown | null> => {
  try {
    return await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, {
      error: `Invalid JSON body: ${describeError(error)}`,
    });
    return null;
  }
};

// Validate the body of POST /api/chat.
// Returns null and writes a 400 if required fields are missing.
type ChatRequestBody = {
  sessionId: string;
  message: string;
};

const parseChatRequest = (
  body: unknown,
  response: ServerResponse,
): ChatRequestBody | null => {
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as ChatRequestBody).sessionId !== "string" ||
    typeof (body as ChatRequestBody).message !== "string"
  ) {
    sendJson(response, 400, {
      error: "Body must be { sessionId: string, message: string }.",
    });
    return null;
  }
  return body as ChatRequestBody;
};

// ---------------------------------------------------------------------------
// boot
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

// POST /api/chat — opens an SSE stream, runs ask(), relays text chunks to the client.
const handleChat = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const body = await readJsonBodyOrReject(request, response);
  if (body === null) return;

  const parsed = parseChatRequest(body, response);
  if (!parsed) return;

  const session = getOrCreateSession(parsed.sessionId, deps);

  openSseStream(response);

  // If the client disconnects mid-stream we keep consuming the model response
  // (so history stays consistent) but stop writing to the closed socket.
  let clientStillConnected = true;
  request.on("close", () => {
    clientStillConnected = false;
  });

  try {
    const result = await session.ask(parsed.message, {
      onText: (chunk) => {
        if (clientStillConnected)
          writeSseEvent(response, "chunk", { text: chunk });
      },
    });
    writeSseEvent(response, "done", {
      usage: result.usage,
      kind: result.kind,
      topic: result.topic,
    });
  } catch (error) {
    console.error(formatErrorWithContext("chat", error));
    writeSseEvent(response, "error", { message: describeError(error) });
  } finally {
    closeSseStream(response);
  }
};

// POST /api/reset — clears the session's conversation history.
const handleReset = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const body = await readJsonBodyOrReject(request, response);
  if (body === null) return;

  const sessionId = (body as { sessionId?: unknown })?.sessionId;
  if (typeof sessionId !== "string") {
    sendJson(response, 400, { error: "Body must be { sessionId: string }." });
    return;
  }

  resetSession(sessionId);
  response.writeHead(204);
  response.end();
};

// GET /* — serves the prebuilt client bundle; falls back to index.html for unknown paths.
const handleStatic = async (
  requestUrl: string,
  response: ServerResponse,
): Promise<void> => {
  // Decode URI-escapes and strip query string before joining with the disk path.
  const urlPath = decodeURIComponent(requestUrl.split("?")[0] ?? "/");
  const safePath = urlPath.replace(/\.\./g, ""); // crude path-traversal guard
  const candidate =
    safePath === "/" ? "index.html" : safePath.replace(/^\//, "");
  const fullPath = path.join(CLIENT_DIST_DIR, candidate);

  try {
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const extension = path.extname(fullPath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
    });
    createReadStream(fullPath).pipe(response);
  } catch {
    // Unknown path — fall back to index.html (SPA-friendly behaviour).
    const indexPath = path.join(CLIENT_DIST_DIR, "index.html");
    try {
      await stat(indexPath);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      createReadStream(indexPath).pipe(response);
    } catch {
      sendJson(response, 404, {
        error:
          "Client bundle not found. Run `npm run build:web` first, or use `npm run dev:server` for development.",
      });
    }
  }
};

// ---------------------------------------------------------------------------
// http server
// ---------------------------------------------------------------------------

// Vite dev server is attached here in dev mode; null in prod.
let viteDevServer: ViteDevServer | null = null;

const httpServer = http.createServer((request, response) => {
  const url = request.url ?? "/";
  const method = request.method ?? "GET";

  if (method === "POST" && url === "/api/chat") {
    handleChat(request, response).catch((error: unknown) => {
      console.error(formatErrorWithContext("route:chat", error));
    });
    return;
  }

  if (method === "POST" && url === "/api/reset") {
    handleReset(request, response).catch((error: unknown) => {
      console.error(formatErrorWithContext("route:reset", error));
    });
    return;
  }

  if (method === "GET") {
    // In dev, Vite middleware handles source transforms and HMR.
    // next() fires only if Vite didn't match the path — effectively never for an SPA.
    if (viteDevServer) {
      viteDevServer.middlewares(request, response, () => {
        sendJson(response, 404, { error: `No route for GET ${url}` });
      });
      return;
    }
    handleStatic(url, response).catch((error: unknown) => {
      console.error(formatErrorWithContext("route:static", error));
    });
    return;
  }

  sendJson(response, 404, { error: `No route for ${method} ${url}` });
});

// Wire up Vite in dev mode. Dynamic import keeps Vite out of the prod bundle.
if (IS_DEV) {
  const { createServer: createViteServer } = await import("vite");
  viteDevServer = await createViteServer({
    configFile: VITE_CONFIG_PATH,
    server: {
      middlewareMode: true,
      // Route Vite's HMR WebSocket through the same http server — single port in dev.
      hmr: { server: httpServer },
    },
    appType: "spa",
  });
  console.log("[server] Vite middleware attached (dev mode)");
}

httpServer.listen(PORT, () => {
  console.log(
    `[server] Listening on http://localhost:${PORT} (${IS_DEV ? "dev" : "prod"})`,
  );
});

// Graceful shutdown so `node --watch` restarts cleanly without port conflicts.
const shutdown = (signal: string) => {
  console.log(`[server] Received ${signal}, shutting down.`);
  httpServer.close(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
