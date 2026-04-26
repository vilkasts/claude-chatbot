import Anthropic from "@anthropic-ai/sdk";

// One graded answer - produced for every test case in the eval dataset.
export interface Grade {
  strengths: string;
  weaknesses: string;
  reasoning: string;
  score: number;
}

// Args the eval runner passes to gradeAnswer for each test case.
export interface GradeAnswerArgs {
  question: string;
  criteria: string[];
  answer: string;
}

// One shared client for the whole grader module.
// The SDK reads ANTHROPIC_API_KEY from the environment automatically.
const anthropicClient = new Anthropic();

// Haiku is plenty for grading - it's cheap, fast and just needs to follow the rubric.
const GRADER_MODEL = "claude-haiku-4-5";

// System prompt for the grader. We tell it the score scale up front and force it
// to think through strengths/weaknesses BEFORE giving the final number.
const GRADER_SYSTEM_PROMPT = `Ты - строгий, объективный grader качества ответов чат-бота помощи по приложению Clientsy.

Твоя задача - оценить ответ бота по заданным критериям и вызвать инструмент submit_grade.

Шкала score:
- 1–3: ответ грубо неверный, выдумывает несуществующее, или нарушает все критерии
- 4–6: ответ частично корректный, но упускает важные критерии или содержит неточности
- 7–8: ответ корректный, выполняет большинство критериев
- 9–10: ответ полностью соответствует всем критериям, точный, ничего не выдумано

Сначала проанализируй strengths/weaknesses/reasoning в полях инструмента, и только потом давай score.`;

// Tool definition forces the response into a strict JSON shape.
// We later read tool_use.input directly - no flaky regex / prefill parsing.
const GRADER_TOOLS: Anthropic.Tool[] = [
  {
    name: "submit_grade",
    description:
      "Сохранить итоговую оценку ответа бота со всеми обоснованиями.",
    input_schema: {
      type: "object",
      properties: {
        strengths: {
          type: "string",
          description: "Что в ответе хорошо (1-2 предложения).",
        },
        weaknesses: {
          type: "string",
          description: "Что в ответе плохо или упущено (1-2 предложения).",
        },
        reasoning: {
          type: "string",
          description: "Краткое объяснение итогового score (1-2 предложения).",
        },
        score: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "Итоговая оценка от 1 до 10.",
        },
      },
      required: ["strengths", "weaknesses", "reasoning", "score"],
    },
  },
];

// Build the user message we send to the grader.
// Each section is wrapped in xml-ish tags so the model can find them reliably.
const buildGraderUserPrompt = (args: GradeAnswerArgs): string => {
  const { question, criteria, answer } = args;
  const numberedCriteria = criteria
    .map((criterion, index) => `${index + 1}. ${criterion}`)
    .join("\n");

  return `<question>
${question}
</question>

<criteria>
${numberedCriteria}
</criteria>

<bot_answer>
${answer}
</bot_answer>

Оцени ответ и вызови submit_grade с заполненными полями.`;
};

// Public entry point - called by runEval for every test case.
// Returns `{ strengths, weaknesses, reasoning, score }`. Score 0 means
// something went wrong (no tool call returned).
export const gradeAnswer = async ({
  question,
  criteria,
  answer,
}: GradeAnswerArgs): Promise<Grade> => {
  const graderUserPrompt = buildGraderUserPrompt({
    question,
    criteria,
    answer,
  });

  // We pin tool_choice to submit_grade so the model can't reply with free text -
  // it MUST fill the tool input. Saves us a parsing branch.
  const graderResponse = await anthropicClient.messages.create({
    model: GRADER_MODEL,
    max_tokens: 600,
    temperature: 0,
    system: GRADER_SYSTEM_PROMPT,
    tools: GRADER_TOOLS,
    tool_choice: { type: "tool", name: "submit_grade" },
    messages: [{ role: "user", content: graderUserPrompt }],
  });

  // Find the tool_use block. Even with forced tool_choice, the SDK may still
  // return text blocks alongside it - we only care about the tool input.
  const submitGradeToolUse = graderResponse.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "submit_grade",
  );

  // Defensive fallback. We don't crash the whole eval - just record a 0 score
  // with a hint about what happened, and let the eval keep going.
  if (!submitGradeToolUse) {
    return {
      strengths: "(no tool call)",
      weaknesses: "Grader did not call submit_grade.",
      reasoning: `stop_reason=${graderResponse.stop_reason}`,
      score: 0,
    };
  }

  // tool_use.input is `unknown` - cast to our Grade shape since the schema
  // above forces all four required fields with the right types.
  return submitGradeToolUse.input as Grade;
};
