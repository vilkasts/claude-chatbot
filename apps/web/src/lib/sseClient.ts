// Tiny SSE client over fetch + ReadableStream.
// We do not use the browser's EventSource because it only supports GET and
// can't carry a JSON body. fetch + getReader works in every modern browser
// and gives us full control over the connection.

interface StreamChatArgs {
  sessionId: string;
  message: string;
  onChunk: (text: string) => void;
  onDone: (info: DoneEventPayload) => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
}

export interface DoneEventPayload {
  usage: unknown;
  kind: string;
  topic?: string;
}

interface ChunkEventPayload {
  text: string;
}

interface ErrorEventPayload {
  message: string;
}

// Walk byte buffer for `\n\n` frame boundaries. Returns array of completed
// frames + leftover string for the next round.
const extractFrames = (
  buffer: string,
): { frames: string[]; remainder: string } => {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";
  return { frames: parts, remainder };
};

// Parse one SSE frame (lines like "event: chunk" / "data: {...}").
// Comment lines start with ":" and are ignored.
interface ParsedFrame {
  event: string;
  data: string;
}
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
        // Malformed JSON in a frame - skip it instead of crashing the stream.
      }
    }
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
