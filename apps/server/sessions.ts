import type { ChatSession } from "../../bot/core/chat.js";
import { createChatSession } from "../../bot/core/chat.js";
import type { LoadedDocs } from "../../bot/core/loadDocs.js";

// In-memory store: sessionId -> ChatSession.
// One process = one map. If the server restarts, all conversations are lost -
// that is fine for a single-user learning project. Anything bigger would
// need redis or a database keyed on a real user id.
const sessionsBySessionId = new Map<string, ChatSession>();

type SessionDeps = {
  docs: LoadedDocs;
  system: string;
};

// Look up an existing chat session for `sessionId`, or create a fresh one
// the first time we see it. Same docs/system across all sessions.
export const getOrCreateSession = (
  sessionId: string,
  deps: SessionDeps,
): ChatSession => {
  const existing = sessionsBySessionId.get(sessionId);
  if (existing) return existing;

  const fresh = createChatSession({ system: deps.system, docs: deps.docs });
  sessionsBySessionId.set(sessionId, fresh);
  return fresh;
};

// Wipe a session's conversation history. Returns true if a session existed.
// Used by POST /api/reset when the user hits the "Сбросить" button.
export const resetSession = (sessionId: string): boolean => {
  const session = sessionsBySessionId.get(sessionId);
  if (!session) return false;
  session.reset();
  return true;
};
