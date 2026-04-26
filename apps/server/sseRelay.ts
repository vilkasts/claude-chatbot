import type { ServerResponse } from "node:http";

// Open an SSE response. Must be called before any writeSseEvent.
// We disable nginx-style buffering so chunks reach the browser immediately.
export const openSseStream = (res: ServerResponse): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Some proxies wait for the first byte before forwarding headers - send a
  // comment line right away so the connection is "live" on the client side.
  res.write(": ok\n\n");
};

// Write one SSE frame. `data` is JSON-serialised - that lets the client
// JSON.parse() every event without sniffing the type.
export const writeSseEvent = (
  res: ServerResponse,
  eventName: string,
  data: unknown,
): void => {
  if (res.writableEnded) return;
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

// Close the SSE stream cleanly. Calling end() twice would crash, so we guard.
export const closeSseStream = (res: ServerResponse): void => {
  if (!res.writableEnded) res.end();
};
