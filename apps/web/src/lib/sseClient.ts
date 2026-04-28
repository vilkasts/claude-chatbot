// SSE client built on fetch + ReadableStream.
// We avoid the browser's native EventSource because it only supports GET
// and cannot carry a JSON body. fetch + getReader works in every modern browser.

type StreamChatArgs = {
  sessionId: string;
  message: string;
  onChunk: (text: string) => void;
  onDone: (info: DoneEventPayload) => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
};

export interface DoneEventPayload {
  usage: unknown;
  kind: string;
  topic?: string;
}

type ChunkEventPayload = {
  text: string;
};

type ErrorEventPayload = {
  message: string;
};

// Split raw bytes on the SSE frame boundary `\n\n`.
// Returns completed frames and any leftover bytes that aren't a full frame yet.
const extractFrames = (
  buffer: string,
): { frames: string[]; remainder: string } => {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";
  return { frames: parts, remainder };
};

// Parse one SSE frame (lines like "event: chunk" / "data: {...}").
// Lines starting with ":" are SSE comments and are skipped.
type ParsedFrame = {
  event: string;
  data: string;
};

const parseFrame = (frame: string): ParsedFrame | null => {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
};

export const streamChat = async (args: StreamChatArgs): Promise<void> => {
  const { sessionId, message, onChunk, onDone, onError, signal } = args;

  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message }),
      signal,
    });
  } catch (error) {
    // Treat AbortError as a silent cancellation — the user triggered it intentionally.
    if (error instanceof DOMException && error.name === "AbortError") return;
    onError(
      error instanceof Error ? error.message : "Network error contacting bot",
    );
    return;
  }

  if (!response.ok || !response.body) {
    onError(`Server returned HTTP ${response.status}`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { frames, remainder } = extractFrames(buffer);
      buffer = remainder;

      for (const frame of frames) {
        const parsed = parseFrame(frame);
        if (!parsed) continue;

        try {
          if (parsed.event === "chunk") {
            const payload = JSON.parse(parsed.data) as ChunkEventPayload;
            onChunk(payload.text);
          } else if (parsed.event === "done") {
            const payload = JSON.parse(parsed.data) as DoneEventPayload;
            onDone(payload);
          } else if (parsed.event === "error") {
            const payload = JSON.parse(parsed.data) as ErrorEventPayload;
            onError(payload.message);
          }
        } catch {
          // Malformed JSON in a frame — skip rather than crashing the whole stream.
        }
      }
    }
  } finally {
    // Always release the reader so the browser can free the response body,
    // even if we exit early due to an error or AbortSignal.
    reader.cancel();
  }
};

// Convenience wrapper around POST /api/reset.
export const resetChatOnServer = async (sessionId: string): Promise<void> => {
  await fetch("/api/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
};
