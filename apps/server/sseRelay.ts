import type { ServerResponse } from "node:http";

// Open an SSE response. Must be called before any writeSseEvent.
// X-Accel-Buffering disables nginx-style proxy buffering so chunks reach the browser immediately.
export const openSseStream = (response: ServerResponse): void => {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Some proxies wait for the first byte before forwarding — send a comment
  // line immediately so the client sees the connection as "live".
  response.write(": ok\n\n");
};

// Write one SSE frame. Data is JSON-serialised so the client can JSON.parse every event uniformly.
export const writeSseEvent = (
  response: ServerResponse,
  eventName: string,
  data: unknown,
): void => {
  if (response.writableEnded) return;
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
};

// Close the SSE stream. Guards against calling end() twice, which would throw.
export const closeSseStream = (response: ServerResponse): void => {
  if (!response.writableEnded) response.end();
};
