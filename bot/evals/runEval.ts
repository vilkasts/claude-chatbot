import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type Anthropic from "@anthropic-ai/sdk";

import { createChatSession } from "../core/chat.js";
import { describeError, formatErrorWithContext } from "../core/errors.js";
import type { LoadedDocs } from "../core/loadDocs.js";
import { loadDocs } from "../core/loadDocs.js";
import { buildSystem } from "../core/systemPrompt.js";
import type { Grade } from "./grader.js";
import { gradeAnswer } from "./grader.js";

// One row from dataset.json. We trust the file shape - if the JSON is wrong
// the runner will fail loud and that's fine for an internal tool.
interface TestCase {
  id: string;
  category: string;
  question: string;
  criteria: string[];
}

// CLI args after parsing - both flags are optional.
interface CliArgs {
  limit: number | null;
  category: string | null;
}

// Result of running ONE test case end-to-end (ask + grade).
interface CaseResult {
  id: string;
  category: string;
  question: string;
  criteria: string[];
  answer: string;
  usage: Anthropic.Usage | null;
  grade: Grade;
  ms: number;
  error: string | null;
}

// Per-category summary used in the printed report.
interface CategorySummary {
  avg: number;
  n: number;
}

// Aggregated results across the whole dataset.
interface AggregatedResults {
  overallAvg: number;
  byCategorySummary: Record<string, CategorySummary>;
  worstThree: CaseResult[];
}

// Resolve paths relative to this script - works regardless of where you run it from.
const currentScriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIRECTORY = path.resolve(currentScriptDirectory, "..", "docs");
const DATASET_FILE_PATH = path.resolve(currentScriptDirectory, "dataset.json");
const RESULTS_DIRECTORY = path.resolve(currentScriptDirectory, "results");

// ---------------------------------------------------------------------------
// CLI args + small helpers
// ---------------------------------------------------------------------------

// Parse `--limit=5 --category=in_corpus` style args. Tiny on purpose - a real
// arg parser would be overkill for two flags.
const parseCommandLineArgs = (rawArgv: string[]): CliArgs => {
  const parsedArgs: CliArgs = { limit: null, category: null };

  for (const argument of rawArgv.slice(2)) {
    const [key, value] = argument.replace(/^--/, "").split("=");
    if (key === "limit" && value) parsedArgs.limit = Number.parseInt(value, 10);
    else if (key === "category" && value) parsedArgs.category = value;
  }

  return parsedArgs;
};

// Plain arithmetic mean. Returns 0 for an empty list to avoid NaN propagating.
const average = (numbers: number[]): number => {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
};

// Single-place float formatter so the report looks consistent.
const formatScore = (score: number): string => score.toFixed(2);

// ---------------------------------------------------------------------------
// running one test case
// ---------------------------------------------------------------------------

// Send one test question through a fresh session, then grade the answer.
// We always use a NEW session per case so prior cases can't leak into this one.
const runOneTestCase = async (
  testCase: TestCase,
  docs: LoadedDocs,
): Promise<CaseResult> => {
  const session = createChatSession({ system: buildSystem(), docs });
  const startedAtMs = Date.now();

  // Step 1 - ask the bot. If anything blows up, capture the error message
  // so the report still shows what went wrong instead of crashing the whole run.
  let botAnswer = "";
  let usage: Anthropic.Usage | null = null;
  let runError: string | null = null;

  try {
    const askResult = await session.ask(testCase.question, {
      onText: () => {},
    });
    botAnswer = askResult.text;
    usage = askResult.usage;
  } catch (error) {
    runError = describeError(error);
    console.error(`\n  [eval:bot ${testCase.id}] ${runError}`);
  }

  // Step 2 - grade the answer (or stub a 0-score grade if the bot crashed).
  let grade: Grade;
  if (runError) {
    grade = {
      strengths: "",
      weaknesses: `bot crashed: ${runError}`,
      reasoning: "",
      score: 0,
    };
  } else {
    try {
      grade = await gradeAnswer({
        question: testCase.question,
        criteria: testCase.criteria,
        answer: botAnswer,
      });
    } catch (error) {
      const message = describeError(error);
      console.error(`\n  [eval:grader ${testCase.id}] ${message}`);
      grade = {
        strengths: "",
        weaknesses: `grader crashed: ${message}`,
        reasoning: "",
        score: 0,
      };
    }
  }

  const elapsedMs = Date.now() - startedAtMs;

  return {
    id: testCase.id,
    category: testCase.category,
    question: testCase.question,
    criteria: testCase.criteria,
    answer: botAnswer,
    usage,
    grade,
    ms: elapsedMs,
    error: runError,
  };
};

// ---------------------------------------------------------------------------
// aggregation + reporting
// ---------------------------------------------------------------------------

// Build the aggregate stats: overall avg, per-category avg, worst 3 cases.
const aggregateResults = (results: CaseResult[]): AggregatedResults => {
  const allScores = results.map((result) => result.grade.score);
  const overallAvg = average(allScores);

  // Group scores by category - useful for spotting which area regressed.
  const scoresByCategory: Record<string, number[]> = {};
  for (const result of results) {
    if (!scoresByCategory[result.category])
      scoresByCategory[result.category] = [];
    scoresByCategory[result.category]!.push(result.grade.score);
  }

  // Build a `{ category: { avg, n } }` summary the report iterates over.
  const byCategorySummary: Record<string, CategorySummary> = Object.fromEntries(
    Object.entries(scoresByCategory).map(([category, scores]) => [
      category,
      { avg: average(scores), n: scores.length },
    ]),
  );

  // Worst 3 cases by score - sorted ascending so the lowest score comes first.
  const worstThree = [...results]
    .sort((a, b) => a.grade.score - b.grade.score)
    .slice(0, 3);

  return { overallAvg, byCategorySummary, worstThree };
};

interface SummaryPrintInput extends AggregatedResults {
  totalCount: number;
}

// Print a human-friendly summary to the terminal.
const printSummaryToConsole = (input: SummaryPrintInput): void => {
  const { overallAvg, byCategorySummary, worstThree, totalCount } = input;

  console.log("\n─── СВОДКА ─────────────────────────────────────");
  console.log(
    `Общий avg score: ${formatScore(overallAvg)}/10  (n=${totalCount})`,
  );

  console.log("\nПо категориям:");
  for (const [category, { avg, n }] of Object.entries(byCategorySummary)) {
    console.log(`  ${category.padEnd(20)} avg=${formatScore(avg)}  n=${n}`);
  }

  console.log("\nХудшие 3 кейса:");
  for (const result of worstThree) {
    console.log(
      `  [${result.grade.score}/10] ${result.id} - ${result.grade.weaknesses}`,
    );
  }
};

interface SaveResultsInput {
  results: CaseResult[];
  overallAvg: number;
  byCategorySummary: Record<string, CategorySummary>;
}

// Persist the full results JSON to disk so we can compare runs over time.
const saveResultsJson = async (input: SaveResultsInput): Promise<string> => {
  const { results, overallAvg, byCategorySummary } = input;

  await mkdir(RESULTS_DIRECTORY, { recursive: true });

  // Filesystem-friendly timestamp (no colons / dots - Windows hates them).
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFilePath = path.join(
    RESULTS_DIRECTORY,
    `results-${timestamp}.json`,
  );

  await writeFile(
    outputFilePath,
    JSON.stringify(
      { timestamp, overallAvg, byCategory: byCategorySummary, results },
      null,
      2,
    ),
  );

  return outputFilePath;
};

// ---------------------------------------------------------------------------
// main entry
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const args = parseCommandLineArgs(process.argv);

  // Step 1 - load + filter the dataset based on CLI flags.
  const dataset = JSON.parse(
    await readFile(DATASET_FILE_PATH, "utf8"),
  ) as TestCase[];
  let testCases = dataset;
  if (args.category)
    testCases = testCases.filter((tc) => tc.category === args.category);
  if (args.limit) testCases = testCases.slice(0, args.limit);

  if (testCases.length === 0) {
    console.error("[eval] No test cases left after filtering.");
    process.exit(1);
  }

  // Step 2 - load the documentation once. Every test case reuses it.
  console.log(`Загружаю документы из ${DOCS_DIRECTORY}...`);
  const docs = await loadDocs(DOCS_DIRECTORY);
  console.log(
    `Корпус: ${docs.files.length} файл(а), ~${docs.tokensApprox.toLocaleString("ru-RU")} токенов.\n`,
  );

  console.log(`Прогон эвала: ${testCases.length} кейс(ов)\n`);

  // Step 3 - run every case sequentially (parallel would race on rate limits).
  const results: CaseResult[] = [];
  for (let index = 0; index < testCases.length; index += 1) {
    const testCase = testCases[index]!;
    process.stdout.write(
      `[${index + 1}/${testCases.length}] ${testCase.id} (${testCase.category})... `,
    );

    const result = await runOneTestCase(testCase, docs);
    results.push(result);

    process.stdout.write(`score=${result.grade.score}/10 (${result.ms}ms)\n`);
  }

  // Step 4 - aggregate, save, report.
  const { overallAvg, byCategorySummary, worstThree } =
    aggregateResults(results);
  const outputFilePath = await saveResultsJson({
    results,
    overallAvg,
    byCategorySummary,
  });

  printSummaryToConsole({
    overallAvg,
    byCategorySummary,
    worstThree,
    totalCount: results.length,
  });

  console.log(
    `\nПолные результаты: ${path.relative(process.cwd(), outputFilePath)}`,
  );
};

// Top-level error handler - anything unhandled lands here with a clear stack.
main().catch((error: unknown) => {
  console.error(formatErrorWithContext("eval", error));
  process.exit(1);
});
