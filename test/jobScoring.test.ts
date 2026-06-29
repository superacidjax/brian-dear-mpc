import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyJobScoreLearning,
  jobDescriptionSimilarity,
  matchJobDescription,
  matchJobDescriptionWithLearning,
} from "../src/careerEngine.js";
import { newTimestamp, saveAnswerEvaluation } from "../src/brainStore.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "brian-career-test-"));
  delete process.env.BRAIN_STORE;
  process.env.BRAIN_FILE_PATH = path.join(tmpDir, "brain-store.json");
  process.env.CAREER_AI_PROVIDER = "off";
});

afterEach(async () => {
  delete process.env.BRAIN_FILE_PATH;
  await rm(tmpDir, { force: true, recursive: true });
});

describe("job-fit scoring", () => {
  it("keeps obviously unrelated roles low", () => {
    expect(
      matchJobDescription(
        "Lead Teacher role creating lesson plans, managing a preschool classroom, supporting children, following licensing guidelines, and communicating with families.",
      ).fit_score,
    ).toBeLessThanOrEqual(43);

    expect(
      matchJobDescription(
        "Floor Lead for a beauty retail store with customer service, sales goals, opening and closing, inventory management, and coaching sales associates.",
      ).fit_score,
    ).toBeLessThanOrEqual(43);
  });

  it("uses persisted bad human evals to lower similar future scores", async () => {
    const originalJob =
      "Frontend Marketing Designer creating campaign landing pages, brand illustrations, motion graphics, social media assets, Figma mockups, animation, and copywriting.";
    const futureJob =
      "Senior Frontend Brand Designer creating campaign pages, social media assets, Figma systems, illustrations, animation, and marketing copy.";
    const baseScore = matchJobDescription(futureJob).fit_score;
    const now = newTimestamp();

    await saveAnswerEvaluation({
      id: "eval_bad_staff_rails",
      entityType: "answer_evaluation",
      evalKind: "job_score",
      generatedQuestion:
        "Score generated job: Senior Frontend Marketing Designer",
      generatedAnswer: "Score: 58",
      jobDescription: originalJob,
      fitScore: 58,
      fitLabel: "Ok fit",
      status: "rated",
      rating: "too_high",
      calibrationSignal: "too_high",
      scoreAdjustment: -24,
      calibrationReason:
        "Brian marked this job-fit score too high; similar future scores should be lower.",
      createdAt: now,
      updatedAt: now,
      ratedAt: now,
    });

    const learned = await matchJobDescriptionWithLearning(futureJob);

    expect(jobDescriptionSimilarity(originalJob, futureJob)).toBeGreaterThan(
      0.18,
    );
    expect(learned.fit_score).toBeLessThan(baseScore);
    expect(learned.learning?.applied).toBe(true);
    expect(learned.learning?.examples[0]?.evaluation_id).toBe(
      "eval_bad_staff_rails",
    );
    expect(learned.possible_gaps[0]).toMatch(/Human eval calibration lowered/);
  });

  it("scores excellent Brian-shaped roles in the 90s", () => {
    expect(
      matchJobDescription(
        "AI Product Engineering Lead owning agentic AI workflows, human evaluation systems, model-quality feedback loops, Rails APIs, React interfaces, product judgment, and executive stakeholder communication.",
      ).fit_score,
    ).toBeGreaterThanOrEqual(90);

    expect(
      matchJobDescription(
        "Director of Engineering for internal developer platforms, AWS cloud tooling, CI/CD, Rails services, data-heavy workflows, executive roadmaps, and mentoring engineering teams.",
      ).fit_score,
    ).toBeGreaterThanOrEqual(90);
  });

  it("uses too-low human evals to raise similar strong roles", () => {
    const job =
      "Principal Product Engineer for Rails and agentic AI workflows using Ruby on Rails, PostgreSQL, TypeScript, RAG, model evaluation, customer workflow design, and product leadership.";
    const base = { ...matchJobDescription(job), fit_score: 76 };
    const learned = applyJobScoreLearning(base, job, [
      {
        id: "eval_too_low_ai_product",
        entityType: "answer_evaluation",
        evalKind: "job_score",
        generatedQuestion:
          "Score generated job: Principal Product Engineer, Rails and Agentic AI",
        generatedAnswer: "Score: 76",
        jobDescription: job,
        fitScore: 76,
        fitLabel: "Great fit",
        status: "rated",
        rating: "too_low",
        calibrationSignal: "too_low",
        scoreAdjustment: 16,
        createdAt: newTimestamp(),
        updatedAt: newTimestamp(),
      },
    ]);

    expect(learned.fit_score).toBeGreaterThan(base.fit_score);
    expect(learned.learning?.adjustment).toBeGreaterThan(0);
  });

  it("can apply learning from an explicit evaluation list without storage", () => {
    const job =
      "Director of Engineering for internal Rails platforms, AWS developer tooling, CI/CD, technical leadership, and product engineering.";
    const base = matchJobDescription(job);
    const learned = applyJobScoreLearning(base, job, [
      {
        id: "eval_incomplete_platform",
        entityType: "answer_evaluation",
        evalKind: "job_score",
        generatedQuestion:
          "Score generated job: Director of Engineering, Internal Platforms",
        generatedAnswer: "Score: 88",
        jobDescription: job,
        fitScore: 88,
        fitLabel: "Great fit",
        status: "rated",
        rating: "incomplete",
        calibrationSignal: "incomplete",
        scoreAdjustment: -14,
        createdAt: newTimestamp(),
        updatedAt: newTimestamp(),
      },
    ]);

    expect(learned.fit_score).toBeGreaterThanOrEqual(base.fit_score);
    expect(learned.learning?.examples).toHaveLength(1);
  });
});
