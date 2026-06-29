import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fallbackEvalQuestion,
  markInterviewQuestionSkipped,
  parseGeneratedEvalQuestion,
  parseGeneratedJobEval,
  parseGeneratedMockInterviewQuestion,
  rateEvaluation,
} from "../src/brain.js";
import {
  listAnswerEvaluations,
  listBrainFacts,
  newTimestamp,
  saveAnswerEvaluation,
  saveInterviewQuestion,
} from "../src/brainStore.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "brian-eval-test-"));
  delete process.env.BRAIN_STORE;
  delete process.env.SLACK_BOT_TOKEN;
  process.env.BRAIN_FILE_PATH = path.join(tmpDir, "brain-store.json");
  process.env.CAREER_AI_PROVIDER = "off";
});

afterEach(async () => {
  delete process.env.BRAIN_FILE_PATH;
  await rm(tmpDir, { force: true, recursive: true });
});

describe("human evaluation calibration", () => {
  it("persists score calibration metadata when Brian rates a job-score eval bad", async () => {
    const now = newTimestamp();
    await saveAnswerEvaluation({
      id: "eval_teacher_too_high",
      entityType: "answer_evaluation",
      evalKind: "job_score",
      generatedQuestion: "Score generated job: Districtwide Teacher",
      generatedAnswer: "Score: 58",
      jobDescription:
        "Districtwide Teacher Application. Develop lesson plans, manage classroom behavior, teach students, maintain student records, and attend campus-based school activities.",
      fitScore: 58,
      fitLabel: "Ok fit",
      status: "awaiting_rating",
      createdAt: now,
      updatedAt: now,
    });

    await rateEvaluation("eval_teacher_too_high", "bad");

    const rated = (await listAnswerEvaluations()).find(
      (item) => item.id === "eval_teacher_too_high",
    );
    expect(rated?.status).toBe("rated");
    expect(rated?.rating).toBe("bad");
    expect(rated?.calibrationSignal).toBe("too_high");
    expect(rated?.scoreAdjustment).toBe(-24);
    expect(rated?.calibrationReason).toMatch(
      /similar future scores should be lower/i,
    );
  });

  it("adds good answer-quality evals to the brain as approved knowledge", async () => {
    const now = newTimestamp();
    await saveAnswerEvaluation({
      id: "eval_executive_answer",
      entityType: "answer_evaluation",
      evalKind: "answer",
      generatedQuestion: "Does Brian work well with executives?",
      generatedAnswer:
        "Yes. Brian is unusually good at translating executive intent into shipped technical work.",
      status: "awaiting_rating",
      createdAt: now,
      updatedAt: now,
    });

    await rateEvaluation("eval_executive_answer", "good");

    const facts = await listBrainFacts();
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "brain_fact",
          topic: "executive_communication",
          question: "Does Brian work well with executives?",
          answer:
            "Yes. Brian is unusually good at translating executive intent into shipped technical work.",
          source: "brian_human_eval_approved_answer",
          status: "approved",
        }),
      ]),
    );
  });

  it("accepts a fresh model-generated interview question from JSON", () => {
    const question = parseGeneratedEvalQuestion(
      JSON.stringify({
        question:
          "For a Director of Engineering role, how should an interviewer probe Brian's ability to turn executive ambiguity into a technical roadmap?",
        role_context: "Director of Engineering",
        interviewer_lens: "executive communication",
        difficulty: "hard",
      }),
      ["Does Brian work well with executives?"],
    );

    expect(question).toBe(
      "For a Director of Engineering role, how should an interviewer probe Brian's ability to turn executive ambiguity into a technical roadmap?",
    );
  });

  it("rejects generated eval questions that repeat recent prompts or ask forbidden topics", () => {
    expect(
      parseGeneratedEvalQuestion(
        '{"question":"Does Brian work well with executives?"}',
        ["Does Brian work well with executives?"],
      ),
    ).toBeUndefined();
    expect(
      parseGeneratedEvalQuestion(
        '{"question":"What salary and remote-work arrangement would Brian want for this job?"}',
        [],
      ),
    ).toBeUndefined();
  });

  it("keeps the static eval list only as a fallback rotation", () => {
    const now = newTimestamp();
    const question = fallbackEvalQuestion([
      {
        id: "eval_executives",
        entityType: "answer_evaluation",
        evalKind: "answer",
        generatedQuestion: "Does Brian work well with executives?",
        generatedAnswer: "Yes.",
        status: "rated",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    expect(question).not.toBe("Does Brian work well with executives?");
  });

  it("accepts a varied model-generated job description for job-fit evals", () => {
    const generated = parseGeneratedJobEval(
      JSON.stringify({
        title: "Regional Museum Visitor Experience Manager",
        industry: "arts and culture",
        fit_expectation: "low",
        description:
          "A regional museum is hiring a Visitor Experience Manager to oversee front-of-house staff, group tours, ticketing operations, membership desk workflows, volunteer scheduling, and daily guest-service standards. The role requires training seasonal team members, coordinating with education staff, handling visitor escalations, preparing attendance reports, and improving the tone of the guest experience across galleries and public programs. Candidates should bring hands-on museum, hospitality, or cultural venue operations experience, strong scheduling habits, and comfort working weekends during exhibitions and events.",
      }),
      ["Staff Rails Engineer, AI Evaluation Platform"],
    );

    expect(generated).toEqual(
      expect.objectContaining({
        title: "Regional Museum Visitor Experience Manager",
        description: expect.stringContaining("Visitor Experience Manager"),
      }),
    );
  });

  it("rejects generated job evals that repeat titles or expose restricted details", () => {
    const duplicate = parseGeneratedJobEval(
      JSON.stringify({
        title: "Staff Rails Engineer, AI Evaluation Platform",
        description:
          "A software company needs a Staff Rails Engineer to own Rails services, PostgreSQL, AI evaluation workflows, technical direction, mentorship, stakeholder communication, observability, and delivery for a high-scale internal platform. The role works across product and engineering to improve human review tooling, model feedback loops, and developer experience.",
      }),
      ["Staff Rails Engineer, AI Evaluation Platform"],
    );
    const compensation = parseGeneratedJobEval(
      JSON.stringify({
        title: "Director of Engineering",
        description:
          "This role includes salary details and compensation expectations for a Director of Engineering. The leader will manage engineering teams, own technical roadmaps, improve delivery systems, mentor managers, and collaborate with executives on product strategy, internal tools, platform reliability, and organizational planning across multiple workstreams.",
      }),
      [],
    );

    expect(duplicate).toBeUndefined();
    expect(compensation).toBeUndefined();
  });

  it("accepts mock interview follow-up questions about approved brain facts", () => {
    const generated = parseGeneratedMockInterviewQuestion(
      JSON.stringify({
        question:
          "What kind of jazz recordings does Brian return to when he wants to reset his attention, and what does he hear in them?",
        topic: "music",
      }),
      ["What music has shaped Brian's taste, attention, or way of thinking?"],
    );

    expect(generated).toEqual({
      question:
        "What kind of jazz recordings does Brian return to when he wants to reset his attention, and what does he hear in them?",
      topic: "music",
    });
  });

  it("rejects mock interview questions about restricted topics", () => {
    expect(
      parseGeneratedMockInterviewQuestion(
        JSON.stringify({
          question: "What political party best reflects Brian's values?",
          topic: "politics",
        }),
        [],
      ),
    ).toBeUndefined();
  });

  it("does not advance the mock interview loop twice for an already skipped question", async () => {
    const now = newTimestamp();
    await saveInterviewQuestion({
      id: "interview_skip_once",
      entityType: "interview_question",
      question: "What should Brian skip?",
      topic: "boundaries",
      status: "skipped",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      markInterviewQuestionSkipped("interview_skip_once", false),
    ).resolves.toBe("Already skipped.");
  });
});
