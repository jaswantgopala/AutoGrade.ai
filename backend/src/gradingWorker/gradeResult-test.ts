import dotenv from "dotenv";
import assert from "assert";
import { gradeResult } from "./grading";

dotenv.config();

const allowedRemarks = new Set([
  "Excellent",
  "Good",
  "Fair",
  "Poor",
  "Very Poor",
]);

const allowedGrades = new Set(["A", "B", "C", "D", "F"]);

async function runDeterministicFallbackTest() {
  const input = {
    maxScore: 10,
    feedback: "",
    strictness: "Medium" as const,
    rubricContext:
      "2 marks for definition, 4 marks for explanation, 4 marks for examples and clarity.",
    questionPaper: "Explain what polymorphism is in object oriented programming.",
    teacherAnswer: "   ",
    studentAnswer:
      "Polymorphism means same function name can behave differently in different classes. For example, overriding lets subclasses provide their own behavior.",
  };

  console.log("Running deterministic gradeResult fallback test with input:", {
    maxScore: input.maxScore,
    strictness: input.strictness,
  });

  const result = await gradeResult(input);

  assert.equal(typeof result.score, "number", "score must be a number");
  assert.equal(result.score, 0, "score must be 0 when teacherAnswer is missing");

  assert.equal(typeof result.feedback, "string", "feedback must be a string");
  assert.ok(result.feedback.trim().length > 0, "feedback must not be empty");
  assert.ok(
    result.feedback.toLowerCase().includes("reference answer is missing"),
    "feedback should mention missing reference answer"
  );

  assert.equal(typeof result.remark, "string", "remark must be a string");
  assert.equal(result.remark, "Very Poor", "remark should be Very Poor in fallback case");
  assert.equal(result.grade, "F", "grade should be F in fallback case");

  console.log("Deterministic fallback test passed.");
  console.log("Result:", result);
}

async function runOptionalLiveModelTest() {
  if (process.env.RUN_LIVE_GRADE_TEST !== "true") {
    console.log("Skipping live model test. Set RUN_LIVE_GRADE_TEST=true to run it.");
    return;
  }

  const input = {
    maxScore: 10,
    feedback: "Be strict but fair. Reward conceptual correctness over wording.",
    strictness: "Medium" as const,
    rubricContext:
      "2 marks for definition, 4 marks for explanation, 4 marks for examples and clarity.",
    questionPaper: "Explain what polymorphism is in object oriented programming.",
    teacherAnswer:
      "Polymorphism allows one interface to represent many forms. In OOP, method overriding and overloading are common examples.",
    studentAnswer:
      "Polymorphism means same function name can behave differently in different classes. For example, overriding lets subclasses provide their own behavior.",
  };

  console.log("Running optional live model test with Gemini...");
  const result = await gradeResult(input);

  assert.ok(Number.isFinite(result.score), "score must be finite");
  assert.ok(result.score >= 0, "score must be >= 0");
  assert.ok(result.score <= input.maxScore, "score must be <= maxScore");
  assert.ok(allowedGrades.has(result.grade), "grade must be one of allowed values");
  assert.ok(allowedRemarks.has(result.remark), "remark must be one of allowed values");

  console.log("Optional live model test passed.");
  console.log("Live result:", result);
}

async function run() {
  await runDeterministicFallbackTest();
  await runOptionalLiveModelTest();
}

run().catch((error) => {
  console.error(
    "gradeResult test failed:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
