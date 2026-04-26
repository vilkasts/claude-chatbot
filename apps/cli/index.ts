import process, {
  stdin as standardInput,
  stdout as standardOutput,
} from "node:process";
import readline from "node:readline/promises";

import Anthropic from "@anthropic-ai/sdk";

import type { ResponseKind } from "../../bot/core/chat.js";
import { createChatSession } from "../../bot/core/chat.js";
import { formatErrorWithContext } from "../../bot/core/errors.js";
import { loadDocs } from "../../bot/core/loadDocs.js";
import { buildSystem } from "../../bot/core/systemPrompt.js";
import { WELCOME_MESSAGE } from "../../bot/shared/greeting.js";

// Where the bot's knowledge lives - resolved from cwd (the repo root).
const DOCS_DIRECTORY = "./bot/docs";

// Haiku 4.5 pricing (USD per 1M tokens). Update if Anthropic changes prices
// or if we switch to Sonnet/Opus. cacheRead is ~10% of normal input - that's
// where the savings come from across multi-turn sessions.
interface PricingTable {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PRICING_USD_PER_MILLION: PricingTable = {
  input: 1,
  output: 5,
  cacheWrite: 1.25,
  cacheRead: 0.1,
};

// Inputs for the stats footer that appears under every reply.
interface StatsLineInput {
  usage: Anthropic.Usage;
  estimatedInputTokens: number | null;
  kind: ResponseKind;
  topic: string | undefined;
  requestCostUsd: number;
}

// ---------------------------------------------------------------------------
// boot: load documentation and start a session
// ---------------------------------------------------------------------------

// Anything that goes wrong before the REPL even starts is fatal - we have no
// session to fall back to. Print a clear English error and exit non-zero so
// CI / supervisors can detect the failure.
const bootOrExit = async () => {
  try {
    const docs = await loadDocs(DOCS_DIRECTORY);
    const chatSession = createChatSession({ system: buildSystem(), docs });
    return { docs, chatSession };
  } catch (error) {
    console.error(formatErrorWithContext("boot", error));
    process.exit(1);
  }
};

const { docs, chatSession } = await bootOrExit();

console.log(
  `Загружено файлов: ${docs.files.length}, ~${docs.tokensApprox.toLocaleString("ru-RU")} токенов в документах.`,
);

const readlineInterface = readline.createInterface({
  input: standardInput,
  output: standardOutput,
});

console.log("\nClientsy Help Bot. Команды: /reset, /usage, exit\n");
console.log(`Clientsy 🤖: ${WELCOME_MESSAGE}\n`);

// Session-wide state we mutate from the loop.
let lastUsageObject: Anthropic.Usage | null = null;
let totalSessionCostUsd = 0;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Convert a usage object (returned by anthropic) into a dollar amount.
// Each token type has its own price - cache reads are the cheapest.
const calculateRequestCostUsd = (usage: Anthropic.Usage): number => {
  const inputCost = (usage.input_tokens ?? 0) * PRICING_USD_PER_MILLION.input;
  const outputCost =
    (usage.output_tokens ?? 0) * PRICING_USD_PER_MILLION.output;
  const cacheWriteCost =
    (usage.cache_creation_input_tokens ?? 0) *
    PRICING_USD_PER_MILLION.cacheWrite;
  const cacheReadCost =
    (usage.cache_read_input_tokens ?? 0) * PRICING_USD_PER_MILLION.cacheRead;

  return (inputCost + outputCost + cacheWriteCost + cacheReadCost) / 1_000_000;
};

// Build the long stats line that appears under every answer.
// It collects every interesting metric in one place so the user can see at a
// glance how much the request cost and how well caching is working.
const formatStatsLine = (input: StatsLineInput): string => {
  const { usage, estimatedInputTokens, kind, topic, requestCostUsd } = input;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;

  // Optional pieces - only show them when we have something to show.
  const estimatePart =
    estimatedInputTokens != null ? `est=${estimatedInputTokens}, ` : "";
  const kindPart =
    kind && kind !== "answer"
      ? `kind=${kind}${topic ? `(${topic})` : ""}, `
      : "";

  return (
    `[${kindPart}${estimatePart}` +
    `input=${usage.input_tokens}, ` +
    `cache_read=${cacheReadTokens}, ` +
    `cache_create=${cacheCreationTokens}, ` +
    `output=${usage.output_tokens}, ` +
    `cost=$${requestCostUsd.toFixed(6)}, ` +
    `session=$${totalSessionCostUsd.toFixed(6)}]\n\n`
  );
};

// Handle one of our slash commands. Returns true if the input was a command
// (so the main loop knows to skip the regular send-to-model path).
const handleSlashCommand = (userInput: string): boolean => {
  if (userInput === "/reset") {
    chatSession.reset();
    console.log("История очищена.\n");
    return true;
  }

  if (userInput === "/usage") {
    if (!lastUsageObject) console.log("Пока не было ответов.\n");
    else console.log(`Последний usage: ${JSON.stringify(lastUsageObject)}\n`);
    return true;
  }

  return false;
};

// Send the user's message, stream the reply, then print the stats footer.
const sendUserMessageAndPrintReply = async (
  userInput: string,
): Promise<void> => {
  // Captured by the onBudget callback below so we can print it in the stats line.
  let estimatedInputTokens: number | null = null;

  standardOutput.write("\nClientsy 🤖: ");

  const { usage, kind, topic } = await chatSession.ask(userInput, {
    // Stream every text chunk straight to the terminal as it arrives.
    onText: (textChunk) => {
      standardOutput.write(textChunk);
    },
    // Optional pre-flight token estimate - fired once before the actual request.
    onBudget: ({ inputTokens }) => {
      estimatedInputTokens = inputTokens;
    },
  });

  lastUsageObject = usage;
  standardOutput.write("\n\n");

  const requestCostUsd = calculateRequestCostUsd(usage);
  totalSessionCostUsd += requestCostUsd;

  standardOutput.write(
    formatStatsLine({
      usage,
      estimatedInputTokens,
      kind,
      topic,
      requestCostUsd,
    }),
  );
};

// Errors raised by `ask` fall into two camps:
//   * Recoverable: rate limit, transient network, server 5xx - user can retry.
//     We log to stderr and keep the REPL alive.
//   * Unrecoverable: bad api key, malformed request - the loop will keep failing
//     forever. We log AND break out so the user isn't stuck typing into a corpse.
const isFatalApiError = (error: unknown): boolean =>
  error instanceof Anthropic.AuthenticationError ||
  error instanceof Anthropic.PermissionDeniedError ||
  error instanceof Anthropic.BadRequestError;

// ---------------------------------------------------------------------------
// main REPL loop
// ---------------------------------------------------------------------------

let shouldExit = false;

while (!shouldExit) {
  // Read one line from stdin and trim whitespace.
  const userInput = (await readlineInterface.question("You: ")).trim();

  // Empty line - just re-prompt.
  if (!userInput) continue;

  // Quit command - break out so we can close readline cleanly below.
  if (userInput.toLowerCase() === "exit") break;

  // Slash command (/reset, /usage) - handle and re-prompt.
  if (handleSlashCommand(userInput)) continue;

  // Normal message - send it to the bot.
  try {
    await sendUserMessageAndPrintReply(userInput);
  } catch (error) {
    console.error(`\n${formatErrorWithContext("chat", error)}\n`);
    if (isFatalApiError(error)) {
      console.error("[chat] Fatal API error - shutting down REPL.");
      shouldExit = true;
    }
  }
}

readlineInterface.close();
