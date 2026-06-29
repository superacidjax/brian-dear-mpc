import { generateCareerText } from "./ai.js";
import { askBrianCareerSmart } from "./careerEngine.js";
import {
  type AnswerEvaluationItem,
  type BrainFactItem,
  type EvalRating,
  type InterviewQuestionItem,
  listAnswerEvaluations,
  listBrainFacts,
  listInterviewQuestions,
  newBrainId,
  newTimestamp,
  saveAnswerEvaluation,
  saveBrainFact,
  saveInterviewQuestion,
} from "./brainStore.js";
import { sendSlackBotMessage } from "./slack.js";

const INTERVIEW_SEEDS: Array<{ topic: string; question: string }> = [
  {
    topic: "executive_communication",
    question:
      "What is a specific example of Brian working well with executives or senior stakeholders?",
  },
  {
    topic: "team_leadership",
    question:
      "What is Brian's best example of leading a team through ambiguity?",
  },
  {
    topic: "agentic_ai",
    question:
      "What should recruiters know about Brian's agentic AI experience and judgment?",
  },
  {
    topic: "platform_engineering",
    question: "What platform engineering story best explains Brian's leverage?",
  },
  {
    topic: "rails_depth",
    question:
      "What is the strongest proof that Brian is still a serious Rails engineer?",
  },
  {
    topic: "product_excellence",
    question: "Where has Brian shown unusually strong product judgment?",
  },
  {
    topic: "messy_systems",
    question:
      "Tell a story about Brian making a messy or legacy system better.",
  },
  {
    topic: "startup_leadership",
    question:
      "What did Brian learn from starting or scaling startups that a hiring manager should care about?",
  },
  {
    topic: "enterprise_systems",
    question:
      "What is Brian's best example of building mission-critical enterprise or regulated software?",
  },
  {
    topic: "management_style",
    question: "How does Brian make engineers around him better?",
  },
  {
    topic: "failure_learning",
    question:
      "What is a useful professional failure or hard lesson Brian can talk about honestly?",
  },
  {
    topic: "best_fit",
    question:
      "What kinds of companies should be most excited to hire Brian right now?",
  },
  {
    topic: "music",
    question:
      "What music has shaped Brian's taste, attention, or way of thinking?",
  },
  {
    topic: "art",
    question:
      "What kind of art or visual design does Brian care about, and why?",
  },
  {
    topic: "economics",
    question:
      "What economics ideas does Brian find useful when thinking about companies or products?",
  },
  {
    topic: "hobbies",
    question:
      "What hobbies or interests help explain Brian as a person outside work?",
  },
  {
    topic: "learning",
    question:
      "What is something Brian has learned recently that changed how he thinks?",
  },
  {
    topic: "taste",
    question: "What does Brian have unusually strong taste about?",
  },
];

const MOCK_INTERVIEW_TOPICS = [
  "career stories",
  "technical judgment",
  "leadership style",
  "product taste",
  "decision-making",
  "failure and learning",
  "communication",
  "executive collaboration",
  "hobbies",
  "music",
  "art and design",
  "economics",
  "teaching",
  "writing",
  "travel and place",
  "books and ideas",
  "tools and craft",
  "personal operating principles",
  "creative influences",
  "what Brian does for fun",
];

const FALLBACK_EVAL_QUESTIONS = [
  "Does Brian work well with executives?",
  "Is Brian a better fit as a manager, individual contributor, or product engineering lead?",
  "What evidence shows Brian can lead agentic AI work?",
  "How strong is Brian's Rails background?",
  "Can Brian operate in messy systems?",
  "Why should a founder talk to Brian?",
  "What concerns should a hiring manager validate in an interview?",
  "Is Brian a fit for a mission-critical enterprise system?",
  "What kind of engineering culture would get the most out of Brian?",
  "When should a company hire Brian instead of a narrower specialist?",
  "What is Brian's strongest Apple story for platform engineering?",
  "How should Brian talk about the Maryland Paid Family and Medical Leave platform?",
  "What is Brian's best example of turning ambiguity into shipped software?",
  "Where does Brian combine product taste with backend engineering depth?",
  "What would make Brian valuable to a startup that needs senior judgment fast?",
  "What kinds of roles are probably not right for Brian?",
  "How should Brian position his AI evaluation experience honestly?",
  "What is Brian's best example of improving developer productivity?",
  "How does Brian balance hands-on coding with leadership?",
  "What should a CTO know about Brian after five minutes?",
  "What is Brian's sharpest story for Rails modernization?",
  "What signals suggest Brian can work across product, design, and engineering?",
  "How does Brian handle regulated or high-stakes product work?",
  "What is the most memorable way to summarize Brian's career arc?",
  "Where might Brian be strongest as a fractional or consulting engineering leader?",
  "How does Brian compare to a conventional engineering manager profile?",
  "What would Brian likely improve in a messy engineering organization?",
  "What should Brian avoid over-claiming in interviews?",
];

const EVAL_ROLE_CONTEXTS = [
  "Staff Rails Engineer",
  "Principal Product Engineer",
  "AI Platform Engineer",
  "AI Evaluation Lead",
  "Product Engineering Lead",
  "Director of Engineering",
  "VP Engineering",
  "Platform Engineering Lead",
  "Startup CTO or founding engineer",
  "Rails modernization lead",
  "Developer productivity lead",
  "Regulated systems engineering lead",
  "Fractional engineering leader",
  "Enterprise product engineering lead",
  "Internal tools and data-heavy UX engineering lead",
];

const EVAL_INTERVIEWER_LENSES = [
  "technical depth",
  "architecture judgment",
  "executive communication",
  "team leadership",
  "product judgment",
  "AI systems judgment",
  "human evaluation design",
  "delivery under ambiguity",
  "incident and risk thinking",
  "legacy-system modernization",
  "startup adaptability",
  "cross-functional collaboration",
  "mentoring senior engineers",
  "operating in regulated environments",
  "tradeoff reasoning",
];

const EVAL_QUESTION_THEMES = [
  "Rails and Ruby depth",
  "agentic AI and model evaluation",
  "platform engineering",
  "product excellence",
  "messy systems",
  "scaling startups",
  "mission-critical enterprise systems",
  "stakeholder management",
  "engineering management",
  "hands-on technical leadership",
  "developer productivity",
  "failure and learning",
  "conflict and prioritization",
  "strategy-to-execution translation",
  "technical taste and standards",
];

const GENERATED_JOB_EVALS = [
  {
    title: "Staff Rails Engineer, AI Evaluation Platform",
    description:
      "We need a Staff Rails Engineer to lead backend architecture for an AI evaluation platform. The role requires Ruby on Rails, PostgreSQL, product judgment, RAG workflows, executive communication, and mentoring senior engineers.",
  },
  {
    title: "Retail Floor Lead, Beauty Store",
    description:
      "We are hiring a Floor Lead for a beauty retail store. Responsibilities include customer service, sales targets, inventory management, product recommendations, opening and closing duties, and coaching sales associates.",
  },
  {
    title: "Director of Engineering, Internal Platforms",
    description:
      "Lead engineering teams building internal developer platforms, CI/CD infrastructure, cloud tooling, and data-heavy product workflows. Must translate executive goals into technical roadmaps and improve delivery quality.",
  },
  {
    title: "Districtwide Teacher",
    description:
      "Develop lesson plans, manage classroom behavior, teach students according to district curriculum, coordinate with parents, keep student records, and participate in campus-based school activities.",
  },
  {
    title: "AI Product Engineering Lead",
    description:
      "Own product engineering for agentic AI workflows, human evaluation systems, model-quality feedback loops, Rails APIs, React interfaces, and cross-functional delivery with product and executive stakeholders.",
  },
  {
    title: "Warehouse Operations Supervisor",
    description:
      "Supervise warehouse associates, maintain inventory accuracy, manage shift schedules, enforce safety procedures, coordinate shipments, and meet daily operational productivity goals.",
  },
  {
    title: "VP Engineering, Developer Productivity and AI Tooling",
    description:
      "Lead engineering teams building developer productivity platforms, AI-assisted internal tooling, CI/CD systems, Rails services, AWS infrastructure, and executive-level technical roadmaps.",
  },
  {
    title: "Principal Product Engineer, Rails and Agentic AI",
    description:
      "Own full-stack product engineering for agentic AI workflows using Ruby on Rails, TypeScript, PostgreSQL, RAG, model evaluation, customer workflow design, and cross-functional product leadership.",
  },
  {
    title: "Director of Platform Engineering, Regulated Fintech",
    description:
      "Lead platform engineering for regulated fintech systems, improving cloud infrastructure, internal tools, delivery quality, stakeholder communication, compliance workflows, and engineering team performance.",
  },
  {
    title: "Senior Frontend Marketing Designer",
    description:
      "Create campaign landing pages, brand illustrations, motion graphics, and social media assets for a consumer marketing team. Requires visual design, Figma, animation, and copywriting.",
  },
];

const JOB_EVAL_INDUSTRIES = [
  "AI infrastructure",
  "developer tools",
  "fintech",
  "health technology",
  "government services",
  "education",
  "retail",
  "logistics",
  "hospitality",
  "media and entertainment",
  "insurance",
  "enterprise SaaS",
  "consumer marketplaces",
  "manufacturing",
  "nonprofit",
  "legal technology",
  "real estate",
  "beauty and wellness",
  "cybersecurity",
  "climate technology",
];

const JOB_EVAL_ROLE_FAMILIES = [
  "excellent Brian fit technical leadership",
  "excellent Brian fit hands-on engineering",
  "adjacent technical role with partial fit",
  "senior product or platform role",
  "engineering management role",
  "AI evaluation or AI platform role",
  "Rails modernization role",
  "non-technical operations role",
  "frontline service role",
  "education role",
  "creative marketing role",
  "sales or customer success role",
  "regulated enterprise systems role",
  "startup founding engineer role",
  "role with misleading leadership keywords but little engineering fit",
];

type BrainFactSource = BrainFactItem["source"];

export async function brainStatus() {
  const [questions, facts, evals] = await Promise.all([
    listInterviewQuestions(),
    listBrainFacts(),
    listAnswerEvaluations(),
  ]);
  return {
    interview_questions: {
      pending: questions.filter((item) => item.status === "pending").length,
      asked: questions.filter((item) => item.status === "asked").length,
      answered: questions.filter((item) => item.status === "answered").length,
      skipped: questions.filter((item) => item.status === "skipped").length,
    },
    brain_facts: facts.length,
    answer_evaluations: {
      awaiting_rating: evals.filter((item) => item.status === "awaiting_rating")
        .length,
      rated: evals.filter((item) => item.status === "rated").length,
    },
  };
}

export async function sendNextInterviewQuestion(): Promise<string> {
  const questions = await listInterviewQuestions();
  const active = questions.find((item) => item.status === "asked");
  if (active) {
    const result = await sendSlackBotMessage(
      interviewQuestionMessage(active.question),
      interviewQuestionBlocks(active),
      "mock_interview",
    );
    if (!result.sent)
      return result.reason ?? "Could not re-send active Slack question.";
    await saveInterviewQuestion({ ...active, slackTs: result.ts });
    return `Re-sent active question: ${active.question}`;
  }

  const generated = await nextMockInterviewQuestion(questions);
  const now = newTimestamp();
  const next: InterviewQuestionItem = {
    id: newBrainId("interview"),
    entityType: "interview_question",
    question: generated.question,
    topic: generated.topic,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  await saveInterviewQuestion(next);

  const message = interviewQuestionMessage(next.question);
  const blocks = interviewQuestionBlocks(next);
  const result = await sendSlackBotMessage(message, blocks, "mock_interview");
  if (!result.sent) return result.reason ?? "Could not send Slack question.";

  await saveInterviewQuestion({ ...next, status: "asked", slackTs: result.ts });
  return `Sent: ${next.question}`;
}

async function nextMockInterviewQuestion(
  questions: InterviewQuestionItem[],
): Promise<{ topic: string; question: string }> {
  const generated = await generateMockInterviewQuestion(questions);
  if (generated) return generated;

  const fallback = INTERVIEW_SEEDS[questions.length % INTERVIEW_SEEDS.length];
  return { topic: fallback.topic, question: fallback.question };
}

async function generateMockInterviewQuestion(
  questions: InterviewQuestionItem[],
): Promise<{ topic: string; question: string } | undefined> {
  const facts = await listBrainFacts();
  const recentQuestions = questions.slice(-24).map((item) => item.question);
  const recentFacts = facts.slice(-18).map((item) => ({
    topic: item.topic,
    question: item.question,
    answer: item.answer.slice(0, 420),
  }));
  const answeredTopics = facts.map((item) => item.topic);
  const prompt = [
    "Generate the next Slack mock-interview question for Brian Dear.",
    "Purpose: build a rich private brain about Brian so the career agent can answer with more personality, specificity, and useful context.",
    "Ask one question Brian can answer directly in Slack. It can be professional or personal, but it must stay within non-restricted topics.",
    "Allowed personal areas include hobbies, music, art, economics, books, travel, design taste, teaching, creative influences, tools, craft, learning, stories, and how Brian thinks.",
    "When prior brain facts mention a personal interest, ask a deeper follow-up about that interest instead of starting over.",
    "Also ask professional follow-ups when prior answers reveal useful stories, examples, gaps, or themes worth expanding.",
    "Do not ask about politics, religion, salary, exact location, health, disability, family status, protected-class topics, private identifiers, or anything invasive.",
    "Do not repeat or closely paraphrase recent questions.",
    "Return strict JSON only with this shape:",
    '{"question":"...","topic":"short_snake_case_topic"}',
    "",
    "Topics to rotate through:",
    JSON.stringify(MOCK_INTERVIEW_TOPICS),
    "Answered topics so far:",
    JSON.stringify(answeredTopics.slice(-40)),
    "Recent questions to avoid:",
    JSON.stringify(recentQuestions),
    "Recent approved brain facts for follow-up:",
    JSON.stringify(recentFacts),
  ].join("\n");
  const response = await generateCareerText({
    system:
      "You generate thoughtful, safe, concise interview questions that help build a personal career-agent knowledge base.",
    prompt,
    temperature: 0.9,
    maxTokens: 240,
    timeoutMs: Number(
      process.env.MOCK_INTERVIEW_AI_TIMEOUT_MS ??
        process.env.CAREER_AI_TIMEOUT_MS ??
        8000,
    ),
  });

  return parseGeneratedMockInterviewQuestion(response, recentQuestions);
}

export function parseGeneratedMockInterviewQuestion(
  response: string | undefined,
  recentQuestions: string[],
): { topic: string; question: string } | undefined {
  if (!response) return undefined;

  const jsonText = response.match(/\{[\s\S]*\}/)?.[0] ?? response;
  let payload: unknown;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    const question = cleanGeneratedQuestion(response, recentQuestions);
    return question
      ? { topic: topicFromQuestion(question), question }
      : undefined;
  }

  if (!payload || typeof payload !== "object") return undefined;
  const question = cleanGeneratedQuestion(
    stringField(payload, "question") ?? "",
    recentQuestions,
  );
  if (!question) return undefined;

  const topic = (stringField(payload, "topic") ?? topicFromQuestion(question))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return { topic: topic || topicFromQuestion(question), question };
}

function interviewQuestionMessage(question: string): string {
  return [
    "*Mock interview / brain-building question*",
    question,
    "",
    "Reply with an answer, or use one of the buttons.",
  ].join("\n");
}

function interviewQuestionBlocks(
  question: InterviewQuestionItem,
): Array<Record<string, unknown>> {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: interviewQuestionMessage(question.question),
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Skip this" },
          action_id: "interview_skip",
          value: question.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "This is inappropriate" },
          style: "danger",
          action_id: "interview_inappropriate",
          value: question.id,
        },
      ],
    },
  ];
}

function topicFromQuestion(question: string): string {
  const normalized = question.toLowerCase();
  if (/executive|stakeholder|senior leadership|c[- ]?suite/.test(normalized))
    return "executive_communication";
  if (/team|manager|management|mentor|lead/.test(normalized))
    return "team_leadership";
  if (/ai|agent|llm|eval|rag|mcp/.test(normalized)) return "agentic_ai";
  if (/platform|infrastructure|developer/.test(normalized))
    return "platform_engineering";
  if (/rails|ruby/.test(normalized)) return "rails_depth";
  if (/product|founder|startup/.test(normalized)) return "product_excellence";
  if (/messy|legacy|enterprise|regulated/.test(normalized))
    return "messy_systems";
  if (/music|art|economics|hobbies|outside work|taste/.test(normalized))
    return "personal_context";
  return "interview_answer";
}

export async function addInterviewAnswerToBrain(input: {
  question: string;
  answer: string;
  topic?: string;
  source?: BrainFactSource;
}): Promise<BrainFactItem> {
  const answer = input.answer.trim();
  const now = newTimestamp();
  const fact: BrainFactItem = {
    id: newBrainId("fact"),
    entityType: "brain_fact",
    topic: input.topic ?? topicFromQuestion(input.question),
    question: input.question,
    answer,
    language: "en",
    source: input.source ?? "brian_slack_interview",
    status: "approved",
    createdAt: now,
    updatedAt: now,
  };

  await saveBrainFact(fact);
  return fact;
}

export async function recordInterviewReply(text: string): Promise<string> {
  const answer = text.trim();
  const active = (await listInterviewQuestions()).find(
    (item) => item.status === "asked",
  );
  if (!active) {
    return "No active brain-building question. Say `next question` when you want one.";
  }

  if (/^skip( this)?[.!]?$/i.test(answer)) {
    return markInterviewQuestionSkipped(active.id, false);
  }

  if (/^(this is inappropriate|inappropriate)[.!]?$/i.test(answer)) {
    return markInterviewQuestionSkipped(active.id, true);
  }

  if (answer.length < 12) {
    return "That answer is a little too short to add to the brain. Add a bit more detail, or say `skip this`.";
  }

  const now = newTimestamp();
  await addInterviewAnswerToBrain({
    question: active.question,
    answer,
    topic: active.topic,
    source: "brian_slack_interview",
  });
  await saveInterviewQuestion({
    ...active,
    status: "answered",
    answeredAt: now,
  });
  await sendSlackBotMessage(
    "Added that to the brain.",
    undefined,
    "mock_interview",
  );
  return sendNextInterviewQuestion();
}

export type EvaluationMode = "auto" | "answer" | "job_score";

export async function sendNextEvaluation(
  mode: EvaluationMode = "auto",
): Promise<string> {
  const evals = await listAnswerEvaluations();
  const active = evals.find((item) => item.status === "awaiting_rating");
  if (active) {
    const result = await sendSlackBotMessage(
      `Active eval: ${active.generatedQuestion}`,
      evaluationBlocks(active),
      "human_eval",
    );
    if (!result.sent)
      return result.reason ?? "Could not re-send active Slack eval.";
    await saveAnswerEvaluation({ ...active, slackTs: result.ts });
    return `Re-sent active eval: ${active.generatedQuestion}`;
  }

  const jobEvalCount = evals.filter(
    (item) => item.evalKind === "job_score",
  ).length;
  const answerEvalCount = evals.filter(
    (item) => item.evalKind !== "job_score",
  ).length;
  if (
    mode === "job_score" ||
    (mode === "auto" && jobEvalCount <= answerEvalCount)
  ) {
    return sendNextJobScoreEvaluation(evals.length);
  }

  const question = await nextEvalQuestion(evals);
  const answer = await askBrianCareerSmart(question);
  const now = newTimestamp();
  const item: AnswerEvaluationItem = {
    id: newBrainId("eval"),
    entityType: "answer_evaluation",
    evalKind: "answer",
    generatedQuestion: question,
    generatedAnswer: answer,
    status: "awaiting_rating",
    createdAt: now,
    updatedAt: now,
  };
  await saveAnswerEvaluation(item);

  const blocks = evaluationBlocks(item);

  const result = await sendSlackBotMessage(
    `Human eval: ${question}`,
    blocks,
    "human_eval",
  );
  if (!result.sent) return result.reason ?? "Could not send Slack eval.";

  await saveAnswerEvaluation({ ...item, slackTs: result.ts });
  return `Sent eval: ${question}`;
}

export async function nextEvalQuestion(
  evals: AnswerEvaluationItem[],
): Promise<string> {
  const generated = await generateEvaluationQuestion(evals);
  return generated ?? fallbackEvalQuestion(evals);
}

async function generateEvaluationQuestion(
  evals: AnswerEvaluationItem[],
): Promise<string | undefined> {
  const recentQuestions = evals
    .filter((item) => item.evalKind !== "job_score")
    .slice(-24)
    .map((item) => item.generatedQuestion);
  const approvedFacts = (await listBrainFacts()).slice(-12).map((item) => ({
    topic: item.topic,
    question: item.question,
    answer: item.answer.slice(0, 360),
  }));
  const prompt = [
    "Generate the next human-evaluation question for Brian Dear's AI career agent.",
    "The question will be sent to Brian in Slack, then the agent will answer it and Brian will rate that answer.",
    "Invent one fresh interview question that a real interviewer might ask for one of Brian's target roles.",
    "Cover a wide variety of senior roles over time: Staff Rails Engineer, Director or VP Engineering, AI Platform Engineer, Product Engineering Lead, and adjacent roles.",
    "Vary the interviewer lens across technical depth, architecture, leadership, product judgment, executive communication, AI evaluation, delivery, risk, conflict, failure, and scaling.",
    "Do not ask about salary, compensation, location, remote work, politics, religion, protected-class topics, or anything invasive.",
    "Do not repeat or closely paraphrase any recent question.",
    "Make it specific enough to produce useful training data, but do not invent facts about Brian.",
    "Return strict JSON only with this shape:",
    '{"question":"...","role_context":"...","interviewer_lens":"...","difficulty":"easy|medium|hard"}',
    "",
    "Target roles:",
    JSON.stringify(EVAL_ROLE_CONTEXTS),
    "Interviewer lenses:",
    JSON.stringify(EVAL_INTERVIEWER_LENSES),
    "Themes to rotate through:",
    JSON.stringify(EVAL_QUESTION_THEMES),
    "Recent questions to avoid:",
    JSON.stringify(recentQuestions),
    "Approved Brian context snippets:",
    JSON.stringify(approvedFacts),
  ].join("\n");
  const response = await generateCareerText({
    system:
      "You generate concise, realistic interview questions for a senior engineering career-agent evaluation loop.",
    prompt,
    temperature: 0.85,
    maxTokens: 260,
    timeoutMs: Number(
      process.env.EVAL_QUESTION_AI_TIMEOUT_MS ??
        process.env.CAREER_AI_TIMEOUT_MS ??
        8000,
    ),
  });

  return parseGeneratedEvalQuestion(response, recentQuestions);
}

export function parseGeneratedEvalQuestion(
  response: string | undefined,
  recentQuestions: string[],
): string | undefined {
  if (!response) return undefined;

  const jsonText = response.match(/\{[\s\S]*\}/)?.[0] ?? response;
  let payload: unknown;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    return cleanGeneratedQuestion(response, recentQuestions);
  }

  if (!payload || typeof payload !== "object") return undefined;
  const question = (payload as { question?: unknown }).question;
  if (typeof question !== "string") return undefined;
  return cleanGeneratedQuestion(question, recentQuestions);
}

function cleanGeneratedQuestion(
  question: string,
  recentQuestions: string[],
): string | undefined {
  const cleaned = question
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned.endsWith("?")) return undefined;
  if (cleaned.length < 24 || cleaned.length > 260) return undefined;
  if (
    /\b(salary|compensation|pay|location|relocat|remote|politic(?:s|al)?|party|religion|religious|age|marital|health|disability)\b/i.test(
      cleaned,
    )
  )
    return undefined;
  if (recentQuestions.some((recent) => questionsAreSimilar(cleaned, recent)))
    return undefined;
  return cleaned;
}

function questionsAreSimilar(left: string, right: string): boolean {
  const leftNormalized = normalizeQuestion(left);
  const rightNormalized = normalizeQuestion(right);
  if (leftNormalized === rightNormalized) return true;
  if (
    leftNormalized.includes(rightNormalized) ||
    rightNormalized.includes(leftNormalized)
  )
    return true;

  const leftTokens = new Set(
    leftNormalized.split(" ").filter((token) => token.length > 3),
  );
  const rightTokens = new Set(
    rightNormalized.split(" ").filter((token) => token.length > 3),
  );
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;

  const overlap = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  return overlap / Math.min(leftTokens.size, rightTokens.size) > 0.72;
}

function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(brian|dear|the|that|with|about|would|should|could|what|how|why|when|where|does|can|for)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function stringField(payload: object, key: string): string | undefined {
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function fallbackEvalQuestion(evals: AnswerEvaluationItem[]): string {
  const lastUsedByQuestion = new Map<string, string>();
  for (const item of evals) {
    if (item.evalKind === "job_score") continue;
    lastUsedByQuestion.set(item.generatedQuestion, item.createdAt);
  }

  return [...FALLBACK_EVAL_QUESTIONS].sort((left, right) => {
    const leftUsed = lastUsedByQuestion.get(left);
    const rightUsed = lastUsedByQuestion.get(right);
    if (!leftUsed && rightUsed) return -1;
    if (leftUsed && !rightUsed) return 1;
    if (!leftUsed && !rightUsed) return left.localeCompare(right);
    return leftUsed!.localeCompare(rightUsed!);
  })[0];
}

function evaluationBlocks(
  item: AnswerEvaluationItem,
): Array<Record<string, unknown>> {
  if (item.evalKind === "job_score") {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${item.generatedAnswer}\n\n*Job description:*\n${item.jobDescription ?? ""}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Good" },
            style: "primary",
            action_id: "eval_good",
            value: item.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Too high" },
            style: "danger",
            action_id: "eval_too_high",
            value: item.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Too low" },
            action_id: "eval_too_low",
            value: item.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Incomplete" },
            action_id: "eval_incomplete",
            value: item.id,
          },
        ],
      },
    ];
  }

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Human eval*\n*Question:* ${item.generatedQuestion}\n\n*Answer:*\n${item.generatedAnswer}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Good" },
          style: "primary",
          action_id: "eval_good",
          value: item.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Bad" },
          style: "danger",
          action_id: "eval_bad",
          value: item.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Incomplete" },
          action_id: "eval_incomplete",
          value: item.id,
        },
      ],
    },
  ];
}

async function sendNextJobScoreEvaluation(offset: number): Promise<string> {
  const { matchJobDescriptionWithLearning } = await import("./careerEngine.js");
  const evals = await listAnswerEvaluations();
  const previousJobTitles = evals
    .filter((item) => item.evalKind === "job_score")
    .map((item) =>
      item.generatedQuestion.replace(/^Score generated job:\s*/, ""),
    );
  const generated = await nextJobEval(previousJobTitles, offset, evals);
  const match = await matchJobDescriptionWithLearning(generated.description);
  const score = match.fit_score;
  const label =
    score >= 75 ? "Great Fit" : score >= 45 ? "Good Fit" : "Low Fit";
  const now = newTimestamp();
  const summary = [
    `*Job score eval*`,
    `*Generated role:* ${generated.title}`,
    `*Score:* ${score}`,
    `*Label:* ${label}`,
    `*Reason:* ${match.possible_gaps[0] ?? match.recommended_positioning[0] ?? "No reason available."}`,
  ].join("\n");
  const item: AnswerEvaluationItem = {
    id: newBrainId("eval"),
    entityType: "answer_evaluation",
    evalKind: "job_score",
    generatedQuestion: `Score generated job: ${generated.title}`,
    generatedAnswer: summary,
    jobDescription: generated.description,
    fitScore: score,
    fitLabel: label,
    status: "awaiting_rating",
    createdAt: now,
    updatedAt: now,
  };
  await saveAnswerEvaluation(item);

  const blocks = evaluationBlocks(item);

  const result = await sendSlackBotMessage(
    `Job score eval: ${generated.title} scored ${score}`,
    blocks,
    "human_eval",
  );
  if (!result.sent)
    return result.reason ?? "Could not send Slack job score eval.";

  await saveAnswerEvaluation({ ...item, slackTs: result.ts });
  return `Sent job score eval: ${generated.title}`;
}

async function nextJobEval(
  previousTitles: string[],
  offset: number,
  evals: AnswerEvaluationItem[],
): Promise<{ title: string; description: string }> {
  const generated = await generateJobEval(previousTitles, evals);
  if (generated) return generated;

  const unused = GENERATED_JOB_EVALS.find(
    (item) => !previousTitles.includes(item.title),
  );
  if (unused) return unused;
  return GENERATED_JOB_EVALS[offset % GENERATED_JOB_EVALS.length];
}

async function generateJobEval(
  previousTitles: string[],
  evals: AnswerEvaluationItem[],
): Promise<{ title: string; description: string } | undefined> {
  const recentRated = evals
    .filter((item) => item.evalKind === "job_score")
    .slice(-16)
    .map((item) => ({
      title: item.generatedQuestion.replace(/^Score generated job:\s*/, ""),
      score: item.fitScore,
      rating: item.rating,
      signal: item.calibrationSignal,
    }));
  const prompt = [
    "Generate one realistic job description for Brian Dear's job-fit scoring human-evaluation loop.",
    "Purpose: test whether the scoring engine can distinguish excellent Brian fits, decent adjacent fits, misleading false positives, and clearly wrong roles.",
    "Create variety across technical and non-technical work, seniority, industries, and role families.",
    "Do not keep generating the same Rails/AI leadership role. Include many industries over time.",
    "Some generated jobs should be excellent fits for Brian. Some should be partial fits. Some should be obviously poor fits, including non-technical roles with tempting words like lead, manager, platform, operations, or customer experience.",
    "The description should read like a real job post, 90-220 words, with responsibilities and qualifications.",
    "Do not include salary, compensation, exact location, politics, religion, protected-class topics, or private data.",
    "Do not repeat or closely paraphrase previous generated titles.",
    "Return strict JSON only with this shape:",
    '{"title":"...","industry":"...","fit_expectation":"excellent|partial|low|misleading_false_positive","description":"..."}',
    "",
    "Industries to rotate through:",
    JSON.stringify(JOB_EVAL_INDUSTRIES),
    "Role families to rotate through:",
    JSON.stringify(JOB_EVAL_ROLE_FAMILIES),
    "Previous titles to avoid:",
    JSON.stringify(previousTitles.slice(-40)),
    "Recent rated job evals:",
    JSON.stringify(recentRated),
  ].join("\n");
  const response = await generateCareerText({
    system:
      "You generate realistic, varied job descriptions for evaluating a career-agent job-fit scorer.",
    prompt,
    temperature: 0.95,
    maxTokens: 520,
    timeoutMs: Number(
      process.env.JOB_EVAL_AI_TIMEOUT_MS ??
        process.env.CAREER_AI_TIMEOUT_MS ??
        9000,
    ),
  });

  return parseGeneratedJobEval(response, previousTitles);
}

export function parseGeneratedJobEval(
  response: string | undefined,
  previousTitles: string[],
): { title: string; description: string } | undefined {
  if (!response) return undefined;

  const jsonText = response.match(/\{[\s\S]*\}/)?.[0] ?? response;
  let payload: unknown;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    return undefined;
  }

  if (!payload || typeof payload !== "object") return undefined;
  const title = (stringField(payload, "title") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const description = (stringField(payload, "description") ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (title.length < 4 || title.length > 120) return undefined;
  if (description.length < 220 || description.length > 1800) return undefined;
  if (
    /\b(salary|compensation|pay range|\$|location:|remote in|politic(?:s|al)?|party|religion|religious)\b/i.test(
      description,
    )
  )
    return undefined;
  if (previousTitles.some((previous) => questionsAreSimilar(title, previous)))
    return undefined;

  return { title, description };
}

export async function markInterviewQuestionSkipped(
  id: string,
  inappropriate: boolean,
): Promise<string> {
  const item = (await listInterviewQuestions()).find(
    (question) => question.id === id || question.status === "asked",
  );
  if (!item) return "Could not find the active interview question.";
  if (item.status === "skipped") return "Already skipped.";
  if (item.status === "answered")
    return "That question has already been answered.";

  const now = newTimestamp();
  await saveInterviewQuestion({ ...item, status: "skipped", answeredAt: now });

  if (inappropriate) {
    await saveBrainFact({
      id: newBrainId("fact"),
      entityType: "brain_fact",
      topic: "boundaries",
      question: item.question,
      answer:
        "Brian marked this mock interview question as inappropriate. Avoid asking similar questions in future mock-interview prompts.",
      language: "en",
      source: "brian_slack_interview",
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });
    await sendSlackBotMessage(
      "Marked inappropriate and added that boundary to the brain.",
      undefined,
      "mock_interview",
    );
  } else {
    await sendSlackBotMessage(
      "Skipped. No problem.",
      undefined,
      "mock_interview",
    );
  }

  return sendNextInterviewQuestion();
}

export async function rateEvaluation(
  id: string,
  rating: EvalRating,
): Promise<string> {
  const item = (await listAnswerEvaluations()).find(
    (evalItem) => evalItem.id === id,
  );
  if (!item) return "Could not find that evaluation.";
  if (item.status === "rated")
    return `Already recorded: ${item.rating ?? "rated"}.`;

  const ratedAt = newTimestamp();
  const calibration =
    item.evalKind === "job_score"
      ? jobScoreCalibrationFor(item.fitScore, rating, item.jobDescription)
      : {};
  await saveAnswerEvaluation({
    ...item,
    status: "rated",
    rating,
    ...calibration,
    ratedAt,
  });

  if (item.evalKind === "answer" && rating === "good") {
    await addInterviewAnswerToBrain({
      question: item.generatedQuestion,
      answer: item.generatedAnswer,
      source: "brian_human_eval_approved_answer",
    });
  }

  await sendSlackBotMessage(
    `Recorded eval rating: *${rating}*.`,
    undefined,
    "human_eval",
  );
  return sendNextEvaluation();
}

function jobScoreCalibrationFor(
  fitScore: number | undefined,
  rating: EvalRating,
  jobDescription?: string,
): Pick<
  AnswerEvaluationItem,
  "calibrationSignal" | "scoreAdjustment" | "calibrationReason"
> {
  if (typeof fitScore !== "number") {
    return {
      calibrationSignal: rating === "good" ? "confirmed" : "incomplete",
      scoreAdjustment: 0,
      calibrationReason: "No original fit score was available for calibration.",
    };
  }

  if (rating === "good") {
    return {
      calibrationSignal: "confirmed",
      scoreAdjustment: 0,
      calibrationReason: "Brian confirmed this job-fit score.",
    };
  }

  if (rating === "too_high") {
    return {
      calibrationSignal: "too_high",
      scoreAdjustment:
        typeof fitScore === "number" && fitScore >= 75 ? -28 : -14,
      calibrationReason:
        "Brian marked this job-fit score too high; similar future scores should be lower.",
    };
  }

  if (rating === "too_low") {
    return {
      calibrationSignal: "too_low",
      scoreAdjustment: typeof fitScore === "number" && fitScore >= 75 ? 16 : 28,
      calibrationReason:
        "Brian marked this job-fit score too low; similar future scores should be higher.",
    };
  }

  if (rating === "incomplete") {
    const strongRole = jobDescription
      ? /\b(rails|ruby|ai|agentic|platform|developer productivity|product engineering|director of engineering|vp engineering|staff engineer|principal engineer)\b/i.test(
          jobDescription,
        )
      : false;
    const adjustment = strongRole
      ? 8
      : fitScore >= 75
        ? -14
        : fitScore >= 45
          ? -7
          : 0;
    return {
      calibrationSignal: "incomplete",
      scoreAdjustment: adjustment,
      calibrationReason:
        "Brian marked this job-fit evaluation incomplete; similar future scores should be more cautious.",
    };
  }

  const strongRole = jobDescription
    ? /\b(rails|ruby|ai|agentic|platform|developer productivity|product engineering|director of engineering|vp engineering|staff engineer|principal engineer)\b/i.test(
        jobDescription,
      )
    : false;
  const adjustment =
    strongRole && typeof fitScore === "number" && fitScore < 90
      ? 18
      : fitScore >= 75
        ? -34
        : fitScore >= 45
          ? -24
          : 24;
  return {
    calibrationSignal:
      strongRole && typeof fitScore === "number" && fitScore < 90
        ? "too_low"
        : fitScore >= 45
          ? "too_high"
          : "too_low",
    scoreAdjustment: adjustment,
    calibrationReason:
      strongRole && typeof fitScore === "number" && fitScore < 90
        ? "Brian marked this strong-fit job score bad; similar future scores should be higher."
        : fitScore >= 45
          ? "Brian marked this job-fit score bad; similar future scores should be lower."
          : "Brian marked this low job-fit score bad; similar future scores may need to be higher.",
  };
}
