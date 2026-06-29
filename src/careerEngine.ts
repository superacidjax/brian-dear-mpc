import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CareerData,
  JobMatch,
  Market,
  ProjectTheme,
  QuestionType,
  RoleLevel,
  RoleType,
} from "./types.js";
import type { AnswerEvaluationItem } from "./brainStore.js";
import { synthesizeCareerAnswer } from "./ai.js";
import { getRelevantBrainFacts } from "./brainFacts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadCareerData(): CareerData {
  const candidates = [
    path.resolve(process.cwd(), "src/data/career.json"),
    path.resolve(process.cwd(), "dist/data/career.json"),
    path.resolve(__dirname, "data/career.json"),
    path.resolve(__dirname, "../src/data/career.json"),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as CareerData;
    } catch {
      // Try the next likely location. This keeps local dev and compiled runs simple.
    }
  }

  throw new Error("Could not load src/data/career.json");
}

export const careerData = loadCareerData();

const themeLabels: Record<ProjectTheme, string> = {
  ai: "AI",
  healthcare: "healthcare",
  rails: "Rails",
  platform: "platform",
  leadership: "leadership",
  regulated_systems: "regulated systems",
  startup: "startup",
  developer_productivity: "developer productivity",
  product_engineering: "product engineering",
};

const allKeywordEntries = Object.entries(careerData.keywords);

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesKeyword(text: string, keyword: string): boolean {
  const normalizedText = normalize(text);
  const normalizedKeyword = normalize(keyword);

  if (/^[a-z0-9.+#-]{1,3}$/.test(normalizedKeyword)) {
    return new RegExp(
      `(^|[^a-z0-9])${escapeRegExp(normalizedKeyword)}([^a-z0-9]|$)`,
    ).test(normalizedText);
  }

  return normalizedText.includes(normalizedKeyword);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

type SupportedLanguage = "en" | "es" | "ca" | "fr" | "de" | "nl";

function detectLanguage(text: string): SupportedLanguage {
  const normalized = normalize(text);
  if (
    /[¿¡]/.test(text) ||
    /\b(salario|sueldo|ubicacion|ubicación|entrevista|trabaja bien|ejecutivos)\b/.test(
      normalized,
    )
  )
    return "es";
  if (
    /\b(salari|sou|ubicacio|ubicació|entrevista|executius|treballa be|treballa bé)\b/.test(
      normalized,
    )
  )
    return "ca";
  if (
    /\b(salaire|localisation|emplacement|entretien|dirigeants|cadres|travaille bien)\b/.test(
      normalized,
    )
  )
    return "fr";
  if (
    /\b(gehalt|standort|ort|vorstellungsgespräch|interview|führungskräfte|manager|arbeitet gut)\b/.test(
      normalized,
    )
  )
    return "de";
  if (
    /\b(salaris|loon|locatie|vestigingsplaats|gesprek|sollicitatiegesprek|directie|leidinggevenden)\b/.test(
      normalized,
    )
  )
    return "nl";
  return "en";
}

function interviewRouteAnswer(question: string): string {
  const language = detectLanguage(question);
  const answers: Record<SupportedLanguage, string> = {
    en: "That's a great question to ask Brian! Do you want to schedule an interview?",
    es: "Esa es una gran pregunta para hacerle a Brian. ¿Quieres programar una entrevista?",
    ca: "Aquesta és una gran pregunta per fer-li a Brian. Vols programar una entrevista?",
    fr: "C'est une excellente question à poser à Brian. Voulez-vous planifier un entretien ?",
    de: "Das ist eine gute Frage für Brian. Möchten Sie ein Gespräch vereinbaren?",
    nl: "Dat is een goede vraag om aan Brian te stellen. Wil je een gesprek plannen?",
  };
  return answers[language];
}

function isLogisticsQuestion(question: string): boolean {
  return /(salary|compensation|pay|rate|equity|hourly|bonus|location|located|where does|where is|relocat|remote|timezone|time zone|salario|sueldo|remuneraci[oó]n|ubicaci[oó]n|localizaci[oó]n|salari|ubicaci[oó]|salaire|localisation|emplacement|gehalt|standort|salaris|loon|locatie)/i.test(
    question,
  );
}

function topMatchesForText(
  text: string,
): Array<{ category: string; count: number; keywords: string[] }> {
  return allKeywordEntries
    .map(([category, keywords]) => {
      const matched = keywords.filter((keyword) =>
        includesKeyword(text, keyword),
      );
      return { category, count: matched.length, keywords: matched };
    })
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

function projectEvidenceFor(category: string): string | undefined {
  const theme = category as ProjectTheme;
  const preferredProjectByTheme: Partial<Record<ProjectTheme, string>> = {
    ai: "Apple AI/ML Human Evaluation Platform",
    rails: "Apple AI/ML Human Evaluation Platform",
    platform: "Apple Developer Productivity and CI/CD",
    leadership: "Maryland Paid Family and Medical Leave Platform",
    developer_productivity: "Apple Developer Productivity and CI/CD",
    product_engineering: "Maryland Paid Family and Medical Leave Platform",
    regulated_systems: "Maryland Paid Family and Medical Leave Platform",
    startup: "Take the Interview",
  };
  const preferred = preferredProjectByTheme[theme];
  const project =
    careerData.projects.find((item) => preferred && item.name === preferred) ??
    careerData.projects.find((item) => item.themes.includes(theme));
  if (!project) return undefined;
  return `${themeLabels[theme] ?? category}: ${project.name} - ${project.summary}`;
}

function experienceEvidenceFor(text: string): string[] {
  const normalized = normalize(text);
  return careerData.experience
    .map((job) => {
      const hits = job.highlights.filter((highlight) =>
        normalize(highlight)
          .split(/[^a-z0-9.+/#-]+/)
          .some((word) => word.length > 3 && normalized.includes(word)),
      );
      return hits.length > 0 ? `${job.company}: ${hits[0]}` : "";
    })
    .filter(Boolean)
    .slice(0, 3);
}

export function brianFitStrength(
  jobDescription: string,
): "excellent" | "strong" | "possible" | "unrelated" {
  const text = normalize(jobDescription);
  const hasEngineeringRole =
    /\b(staff|principal|senior|lead|director|vp|head|manager|architect|cto)\b/.test(
      text,
    ) &&
    /\b(engineer|engineering|developer|software|platform|technical|technology|product)\b/.test(
      text,
    );
  const hasRails = /\b(rails|ruby|postgres|postgresql)\b/.test(text);
  const hasAi =
    /\b(ai|ml|llm|rag|agent|agentic|eval|evaluation|model|mcp)\b/.test(text);
  const hasPlatform =
    /\b(platform|developer productivity|internal tools|ci\/cd|cicd|infrastructure|cloud|aws|tooling|data-heavy|data platform)\b/.test(
      text,
    );
  const hasProduct =
    /\b(product engineering|product judgment|product lead|cross-functional|roadmap|customer|workflow)\b/.test(
      text,
    );
  const hasLeadership =
    /\b(lead|leader|leadership|mentor|mentoring|manage|manager|director|vp|head|executive|stakeholder|roadmap)\b/.test(
      text,
    );
  const hasStartup =
    /\b(founder|startup|zero to one|0 to 1|scale|scaling)\b/.test(text);
  const hasUnrelated =
    /\b(teacher|classroom|preschool|childcare|retail|sales associate|beauty|warehouse|forklift|restaurant|server|bartender|nurse|driver)\b/.test(
      text,
    ) &&
    !/\b(software|engineer|engineering|developer|platform|ai|rails|ruby|product engineering)\b/.test(
      text,
    );

  if (hasUnrelated) return "unrelated";

  const signalCount = [
    hasRails,
    hasAi,
    hasPlatform,
    hasProduct,
    hasLeadership,
    hasStartup,
  ].filter(Boolean).length;
  if (hasEngineeringRole && signalCount >= 3) return "excellent";
  if (
    (hasRails && hasAi) ||
    (hasPlatform && hasLeadership && hasProduct) ||
    (hasAi && hasProduct && hasLeadership)
  )
    return "excellent";
  if (hasEngineeringRole && signalCount >= 2) return "strong";
  if (hasRails || hasAi || hasPlatform || (hasProduct && hasLeadership))
    return "strong";
  if (hasEngineeringRole || hasProduct || hasLeadership) return "possible";
  return "unrelated";
}

export function getResumeSummary(roleType: RoleType): string {
  const summary =
    careerData.role_summaries[roleType] ?? careerData.role_summaries.general;
  const evidenceByRole: Partial<Record<RoleType, string[]>> = {
    ai_platform: [
      "Built Rails software for AI/ML human evaluation workflows",
      "Built RAG and internal documentation search tools",
      "Built Apple Data Platform React/data-heavy UX",
      "Reduced Apple build times by roughly 90% with CI/CD and distributed compilation work",
    ],
    rails: [
      "Deep Ruby on Rails background across startups, Apple, fintech, government benefits, insurance, and enterprise modernization",
      "Modernized legacy Rails estates and built greenfield Rails products",
      "Shipped internal APIs, async services, and operational tooling",
    ],
    product_engineering: [
      "Turns ambiguous workflows into usable software",
      "Owned product and engineering across iCouch, Maryland Paid Family and Medical Leave, Apple internal tools, and Beyond Finance",
      "Connects domain understanding, roadmap shaping, architecture, and execution",
    ],
    vp_platform: [
      "Led Apple developer productivity, CI/CD, build infrastructure, and source-control modernization work",
      "Managed roadmaps, teams, stakeholders, and delivery habits",
      "Built remote teams and improved developer velocity in high-stakes environments",
    ],
  };
  const evidence =
    evidenceByRole[roleType] ?? careerData.positioning.slice(0, 5);
  return `${summary}\n\nBest evidence: ${evidence.join("; ")}.`;
}

export function matchJobDescription(jobDescription: string): JobMatch {
  const matches = topMatchesForText(jobDescription);
  const matchedCategories = matches.map((match) => match.category);
  const matchedKeywordCount = matches.reduce(
    (total, match) => total + match.count,
    0,
  );
  const fitStrength = brianFitStrength(jobDescription);
  const hasTargetRoleSignal =
    /\b(software|engineer|engineering|developer|rails|ruby|typescript|javascript|react|node|api|backend|frontend|full.?stack|platform|infrastructure|devops|cloud|aws|ai|ml|llm|rag|agent|mcp|architect|cto)\b|product engineer|technical lead|vp engineering|director of engineering|head of engineering|engineering manager/i.test(
      jobDescription,
    );
  const isEducationRole =
    /(districtwide teacher|teacher application|lead teacher|\bteacher\b|\bteaching\b|student learning|student teacher|pupil|pupils|preschool|child ?care|daycare|classroom|curriculum|lesson plan|lesson plans|texas education agency|board of trustee|school district|grade level|substitutes|pta meetings|paraprofessional|campus-based|licensing guidelines|children|families|early childhood|teacher assistant|toddler|infant)/i.test(
      jobDescription,
    ) && !hasTargetRoleSignal;
  const isRetailRole =
    /(floor lead|shift lead|retail management|senior sales|sales associate|beauty advisor|customer service|sales target|sales goals|store operations|store readiness|opening and closing|inventory management|stock levels|product knowledge|product trends|personalized recommendations|retail|skincare|makeup|beauty products)/i.test(
      jobDescription,
    ) && !hasTargetRoleSignal;
  const unrelatedRoleReason = isEducationRole
    ? "This appears to be a classroom or child-care role, not a software engineering, product engineering, platform, AI, or technical leadership role."
    : isRetailRole
      ? "This appears to be a retail, sales, or store-operations role, not a software engineering, product engineering, platform, AI, or technical leadership role."
      : undefined;
  const hasExplicitUnrelatedRole = Boolean(unrelatedRoleReason);
  const leadershipBoost =
    hasTargetRoleSignal &&
    /(staff|principal|manager|director|vp|head of|platform|architect|technical lead|engineering lead)/i.test(
      jobDescription,
    )
      ? 12
      : 0;
  const aiBoost = /\b(ai|ml|llm|rag|agent|agentic|eval|evaluation|mcp)\b/i.test(
    jobDescription,
  )
    ? 10
    : 0;
  const railsBoost = /\b(rails|ruby|postgres|postgresql)\b/i.test(
    jobDescription,
  )
    ? 10
    : 0;
  const platformBoost =
    /\b(platform|developer productivity|internal tools|ci\/cd|cicd|infrastructure|cloud|aws|tooling|data-heavy|data platform)\b/i.test(
      jobDescription,
    )
      ? 8
      : 0;
  const productBoost =
    /\b(product engineering|product judgment|cross-functional|roadmap|workflow|customer)\b/i.test(
      jobDescription,
    )
      ? 6
      : 0;
  const strengthBoost =
    fitStrength === "excellent"
      ? 14
      : fitStrength === "strong"
        ? 8
        : fitStrength === "possible"
          ? 2
          : 0;
  const rawScore =
    30 +
    matchedKeywordCount * 4 +
    leadershipBoost +
    aiBoost +
    railsBoost +
    platformBoost +
    productBoost +
    strengthBoost;
  const cappedScore = hasExplicitUnrelatedRole
    ? Math.min(24, rawScore)
    : hasTargetRoleSignal
      ? rawScore
      : Math.min(43, rawScore);
  const minimumScore =
    fitStrength === "excellent"
      ? 90
      : fitStrength === "strong"
        ? 82
        : fitStrength === "possible"
          ? 55
          : 1;
  const fitScore = hasExplicitUnrelatedRole
    ? Math.max(1, Math.min(24, cappedScore))
    : Math.max(minimumScore, Math.min(98, cappedScore));

  const strongestMatches = unique([
    ...matches
      .slice(0, 5)
      .map((match) => projectEvidenceFor(match.category))
      .filter((item): item is string => Boolean(item)),
    ...experienceEvidenceFor(jobDescription),
  ]).slice(0, 6);

  const possibleGaps: string[] = [];
  if (
    !hasExplicitUnrelatedRole &&
    !matchedCategories.includes("ai_platform") &&
    /\b(ai|ml|llm|model|agent)\b/i.test(jobDescription)
  ) {
    possibleGaps.push(
      "The job mentions AI, but the description may need a closer mapping to Brian's Apple AI/ML eval, RAG, and tooling work.",
    );
  }
  if (
    !hasExplicitUnrelatedRole &&
    !matchedCategories.includes("healthcare") &&
    /health|clinical|patient|provider|hipaa/i.test(jobDescription)
  ) {
    possibleGaps.push(
      "Healthcare specifics should be tied directly to iCouch and regulated systems experience.",
    );
  }
  if (
    !hasExplicitUnrelatedRole &&
    /frontend|design system|css|ui engineer/i.test(jobDescription) &&
    !/rails|backend|platform|full.?stack/i.test(jobDescription)
  ) {
    possibleGaps.push(
      "Brian has React and data-heavy UX experience, but his strongest center of gravity is Rails, product/platform engineering, and leadership.",
    );
  }
  if (
    !hasExplicitUnrelatedRole &&
    /\b(go|rust|java|scala|elixir)\b/i.test(jobDescription)
  ) {
    possibleGaps.push(
      "The career data does not show deep production ownership in every named language from this job description.",
    );
  }
  if (hasExplicitUnrelatedRole) {
    possibleGaps.push(unrelatedRoleReason!);
  } else if (!hasTargetRoleSignal) {
    possibleGaps.push(
      "This description does not show enough engineering, product, platform, AI, or technical leadership scope to be a strong Brian fit.",
    );
  }
  if (possibleGaps.length === 0) {
    possibleGaps.push(
      "No glaring gaps from the provided description. The interview should validate exact team scope, domain depth, and expectations for hands-on coding versus leadership.",
    );
  }

  const recommendedPositioning = unique([
    hasExplicitUnrelatedRole
      ? "Do not position Brian for this role. It is outside his professional target area."
      : "",
    !hasExplicitUnrelatedRole && !hasTargetRoleSignal
      ? "Ask for a more relevant technical, product, platform, AI, or engineering leadership role before generating a customized resume."
      : "",
    !hasExplicitUnrelatedRole && matchedCategories.includes("ai_platform")
      ? "Lead with Apple's AI/ML human evaluation platform, RAG tooling, eval workflows, and pragmatic AI systems work."
      : "",
    !hasExplicitUnrelatedRole && matchedCategories.includes("rails")
      ? "Position Brian as a senior Rails engineer who can modernize, ship, and lead without treating Rails as nostalgia."
      : "",
    !hasExplicitUnrelatedRole && matchedCategories.includes("vp_platform")
      ? "Use the Apple CI/CD and 90% build-time reduction story as the platform leadership anchor."
      : "",
    !hasExplicitUnrelatedRole && matchedCategories.includes("healthcare")
      ? "Bring iCouch forward early: founder-level healthcare product judgment before telehealth was obvious."
      : "",
    !hasExplicitUnrelatedRole && matchedCategories.includes("regulated_systems")
      ? "Emphasize regulated delivery across mental health, insurance, fintech, and government benefits."
      : "",
    hasExplicitUnrelatedRole
      ? ""
      : "Frame him as someone who can connect product sense, architecture, implementation, and leadership in one conversation.",
  ]).slice(0, 5);

  return {
    fit_score: fitScore,
    strongest_matches:
      strongestMatches.length > 0
        ? strongestMatches
        : careerData.positioning.slice(0, 4),
    possible_gaps: possibleGaps,
    recommended_positioning: recommendedPositioning,
    suggested_cover_letter_angle:
      buildCoverLetterAngle("this team", jobDescription).angles[0]
        ?.opening_line ?? "",
  };
}

const JOB_TOKEN_STOPWORDS = new Set([
  "about",
  "above",
  "after",
  "also",
  "and",
  "are",
  "based",
  "benefits",
  "candidate",
  "company",
  "description",
  "experience",
  "for",
  "from",
  "have",
  "including",
  "job",
  "more",
  "must",
  "our",
  "role",
  "team",
  "that",
  "the",
  "their",
  "this",
  "with",
  "work",
  "you",
  "your",
]);

function jobTokens(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/[^a-z0-9+#.]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !JOB_TOKEN_STOPWORDS.has(token)),
  );
}

function categorySet(text: string): Set<string> {
  return new Set(
    topMatchesForText(text)
      .slice(0, 5)
      .map((match) => match.category),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

export function jobDescriptionSimilarity(left: string, right: string): number {
  const lexical = jaccard(jobTokens(left), jobTokens(right));
  const categories = jaccard(categorySet(left), categorySet(right));
  return lexical * 0.72 + categories * 0.28;
}

function inferredCalibration(
  item: AnswerEvaluationItem,
): { adjustment: number; originalScore: number } | undefined {
  if (
    item.evalKind !== "job_score" ||
    item.status !== "rated" ||
    !item.rating ||
    !item.jobDescription ||
    typeof item.fitScore !== "number"
  ) {
    return undefined;
  }

  if (item.rating === "too_high")
    return {
      adjustment: item.fitScore >= 75 ? -28 : -14,
      originalScore: item.fitScore,
    };
  if (item.rating === "too_low")
    return {
      adjustment: item.fitScore >= 75 ? 16 : 28,
      originalScore: item.fitScore,
    };
  if (typeof item.scoreAdjustment === "number") {
    const strength = brianFitStrength(item.jobDescription);
    if (
      (item.rating === "bad" || item.rating === "incomplete") &&
      item.scoreAdjustment < 0 &&
      (strength === "excellent" || strength === "strong")
    ) {
      return {
        adjustment: item.rating === "bad" ? 18 : 8,
        originalScore: item.fitScore,
      };
    }
    return { adjustment: item.scoreAdjustment, originalScore: item.fitScore };
  }

  if (item.rating === "good")
    return { adjustment: 0, originalScore: item.fitScore };
  if (item.rating === "incomplete") {
    const strength = brianFitStrength(item.jobDescription);
    if (strength === "excellent" || strength === "strong")
      return { adjustment: 8, originalScore: item.fitScore };
    return {
      adjustment: item.fitScore >= 75 ? -14 : item.fitScore >= 45 ? -7 : 0,
      originalScore: item.fitScore,
    };
  }
  const strength = brianFitStrength(item.jobDescription);
  if (
    (strength === "excellent" || strength === "strong") &&
    item.fitScore < 90
  ) {
    return {
      adjustment: item.fitScore >= 75 ? 18 : 28,
      originalScore: item.fitScore,
    };
  }
  return {
    adjustment: item.fitScore >= 75 ? -34 : item.fitScore >= 45 ? -24 : 24,
    originalScore: item.fitScore,
  };
}

export function applyJobScoreLearning(
  baseMatch: JobMatch,
  jobDescription: string,
  evaluations: AnswerEvaluationItem[],
): JobMatch {
  const examples = evaluations
    .map((item) => {
      const calibration = inferredCalibration(item);
      if (!calibration || !item.jobDescription || !item.rating)
        return undefined;
      const similarity = jobDescriptionSimilarity(
        jobDescription,
        item.jobDescription,
      );
      if (similarity < 0.18) return undefined;
      return {
        evaluation_id: item.id,
        similarity,
        rating: item.rating,
        original_score: calibration.originalScore,
        adjustment: calibration.adjustment,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  if (examples.length === 0) {
    return {
      ...baseMatch,
      learning: { applied: false, adjustment: 0, examples: [] },
    };
  }

  const weightedTotal = examples.reduce(
    (total, item) => total + item.adjustment * item.similarity,
    0,
  );
  const similarityTotal = examples.reduce(
    (total, item) => total + item.similarity,
    0,
  );
  const adjustment = Math.round(weightedTotal / similarityTotal);
  const learnedScore = Math.max(
    1,
    Math.min(98, baseMatch.fit_score + adjustment),
  );
  const direction =
    adjustment < 0
      ? "Human eval calibration lowered this score based on similar rated job-fit examples."
      : adjustment > 0
        ? "Human eval calibration raised this score based on similar rated job-fit examples."
        : "Human eval calibration found similar rated examples and kept the score steady.";

  return {
    ...baseMatch,
    fit_score: learnedScore,
    possible_gaps: unique([direction, ...baseMatch.possible_gaps]),
    learning: {
      applied: true,
      adjustment,
      examples,
    },
  };
}

export async function matchJobDescriptionWithLearning(
  jobDescription: string,
): Promise<JobMatch> {
  const baseMatch = matchJobDescription(jobDescription);
  const { listAnswerEvaluations } = await import("./brainStore.js");
  const evaluations = (await listAnswerEvaluations()).filter(
    (item) => item.evalKind === "job_score" && item.status === "rated",
  );
  return applyJobScoreLearning(baseMatch, jobDescription, evaluations);
}

export function getProjectExamples(theme: ProjectTheme) {
  return careerData.projects
    .filter((project) => project.themes.includes(theme))
    .map((project) => ({
      title: project.name,
      context: project.context,
      brian_role: project.role,
      personally_contributed: project.contributions,
      impact: project.impact,
      how_to_talk_about_it_in_an_interview: project.interview_angle,
    }));
}

export function getInterviewStory(questionType: QuestionType): string {
  return (
    careerData.stories[questionType] ??
    "I don't have that in the career data. That is a great question to ask Brian directly in an interview."
  );
}

export function buildCoverLetterAngle(company: string, jobDescription: string) {
  const matches = topMatchesForText(jobDescription);
  const categories = new Set(matches.map((match) => match.category));
  const companyName = company.trim() || "your team";

  const possibleAngles = [
    {
      category: "ai_platform",
      title:
        "AI platform builder who understands evals, tools, and human review",
      why_it_fits:
        "Brian's Apple AI/ML work, RAG tooling, and scoring workflow experience map well to teams building useful AI systems instead of slideware.",
      opening_line: `${companyName} should talk to Brian because he has built the Rails and product infrastructure around AI evaluation, not just watched demos of it.`,
    },
    {
      category: "rails",
      title: "Senior Rails engineer who can modernize without drama",
      why_it_fits:
        "Brian has built and modernized Rails systems across Apple, government, healthcare, fintech, insurance, consulting, and startups.",
      opening_line: `${companyName} needs the kind of Rails judgment that ships product and lowers risk at the same time. Brian has that scar tissue.`,
    },
    {
      category: "healthcare",
      title: "Founder who saw telehealth early",
      why_it_fits:
        "Brian founded iCouch in 2010 and built privacy-sensitive online therapy workflows before telehealth became an obvious category.",
      opening_line: `${companyName} is the kind of place where Brian's early healthcare product instincts and Rails execution can compound quickly.`,
    },
    {
      category: "vp_platform",
      title: "Platform leader who turns developer pain into leverage",
      why_it_fits:
        "Brian's Apple build and release work reduced build times by 90% and modernized source-control workflows across major creative applications.",
      opening_line: `${companyName} should look at Brian as a platform leader who knows developer productivity is a product problem with measurable business impact.`,
    },
    {
      category: "product_engineering",
      title: "Product engineer who turns messy workflows into usable systems",
      why_it_fits:
        "Brian's strongest pattern is converting ambiguous, regulated, or operationally messy domains into software people can actually use.",
      opening_line: `${companyName} should talk to Brian if the role needs someone who can ask the product questions and still own the architecture.`,
    },
    {
      category: "startup",
      title: "Founder-minded operator with enterprise range",
      why_it_fits:
        "Brian has founder experience from iCouch, scaling experience from Take the Interview, and enterprise delivery experience from Apple and regulated systems.",
      opening_line: `${companyName} should talk to Brian because he brings founder urgency without losing enterprise-grade judgment.`,
    },
  ];

  const selected = possibleAngles
    .filter((angle) => categories.has(angle.category))
    .concat(possibleAngles)
    .filter(
      (angle, index, list) =>
        list.findIndex((item) => item.title === angle.title) === index,
    )
    .slice(0, 3);

  return { angles: selected };
}

export function getCompensationTarget(
  roleLevel?: RoleLevel,
  market?: Market,
): string {
  void roleLevel;
  void market;
  return "Compensation is intentionally not included in Brian's public career MCP data. That is a great thing to discuss with Brian directly once role scope, level, location, and expectations are clear.";
}

export function getPublicLinks() {
  return {
    name: careerData.name,
    contact: "Ask in the chat to send Brian a note.",
    links: careerData.public_links,
  };
}

function answerRoleQuestion(question: string): string | undefined {
  const normalized = normalize(question);
  const roleMatch = (Object.keys(careerData.role_summaries) as RoleType[]).find(
    (role) =>
      role === "general"
        ? false
        : includesKeyword(normalized, role.replace("_", " ")),
  );
  if (roleMatch) return getResumeSummary(roleMatch);
  if (/staff|principal|rails|ruby/.test(normalized))
    return getResumeSummary("rails");
  if (/ai|ml|llm|rag|eval|agent|mcp/.test(normalized))
    return getResumeSummary("ai_platform");
  if (/director|vp|platform|leadership|manager/.test(normalized))
    return getResumeSummary("vp_platform");
  if (/health|therapy|clinical|patient|telehealth/.test(normalized))
    return getResumeSummary("healthcare");
  if (/startup|founder|0 to 1|operator/.test(normalized))
    return getResumeSummary("startup");
  return undefined;
}

export interface CareerEvidence {
  question: string;
  role_summary?: string;
  stories: Array<{ type: QuestionType; text: string }>;
  projects: Array<{
    name: string;
    summary: string;
    context: string;
    role: string;
    contributions: string[];
    impact: string;
    interview_angle: string;
  }>;
  experience: Array<{
    company: string;
    title: string;
    highlights: string[];
  }>;
  skills: Record<string, string[]>;
  public_positioning: string[];
  brain_facts?: Array<{
    topic: string;
    question: string;
    answer: string;
    source: string;
    created_at: string;
  }>;
}

export function retrieveCareerEvidence(question: string): CareerEvidence {
  const normalized = normalize(question);
  const matches = topMatchesForText(question);
  const categories = matches.map((match) => match.category);
  const roleSummary = answerRoleQuestion(question);
  const isLeadershipIntent =
    /(lead|leader|leading|managed|manager|management|team|teams|mentor|hiring|director|vp|executive|executives|stakeholder|stakeholders|c[- ]?suite|senior leadership|leadership team|ejecutivo|ejecutivos|interesados|executiu|executius|dirigeant|dirigeants|cadres|f[uü]hrungskraft|f[uü]hrungskr[aä]fte|directie|leidinggevende|leidinggevenden)/.test(
      normalized,
    );
  const storyTypes = (Object.keys(careerData.stories) as QuestionType[]).filter(
    (storyType) => includesKeyword(normalized, storyType.replace("_", " ")),
  );

  if (isLeadershipIntent) {
    storyTypes.push("leadership");
  }
  if (/(own|owner|ownership|accountable|accountability)/.test(normalized)) {
    storyTypes.push("ownership");
  }
  if (/(ambiguous|ambiguity|messy|unclear|undefined)/.test(normalized)) {
    storyTypes.push("ambiguity");
  }

  const selectedThemes = new Set<ProjectTheme>();
  for (const category of categories) {
    if (category in themeLabels) selectedThemes.add(category as ProjectTheme);
  }
  if (isLeadershipIntent) {
    selectedThemes.add("leadership");
    selectedThemes.add("platform");
  }

  const projects = careerData.projects
    .filter(
      (project) =>
        project.themes.some((theme) => selectedThemes.has(theme)) ||
        includesKeyword(normalized, project.name),
    )
    .slice(0, 5)
    .map((project) => ({
      name: project.name,
      summary: project.summary,
      context: project.context,
      role: project.role,
      contributions: project.contributions,
      impact: project.impact,
      interview_angle: project.interview_angle,
    }));

  const leadershipExperience = isLeadershipIntent
    ? careerData.experience.filter((job) =>
        job.highlights.some((highlight) =>
          /led|managed|team|teams|mentored|hiring|stakeholder|roadmap|leadership|senior|business goals|release operations/i.test(
            highlight,
          ),
        ),
      )
    : [];

  const keywordExperience = careerData.experience.filter((job) =>
    job.highlights.some((highlight) =>
      normalized
        .split(/[^a-z0-9.+/#-]+/)
        .filter((word) => word.length > 4)
        .some((word) => includesKeyword(highlight, word)),
    ),
  );

  const experience = unique(
    [...leadershipExperience, ...keywordExperience].map((job) => job.company),
  )
    .map((company) => {
      const job = [...leadershipExperience, ...keywordExperience].find(
        (entry) => entry.company === company,
      )!;
      return {
        company: job.company,
        title: job.title,
        highlights: job.highlights
          .filter((highlight) =>
            /led|managed|team|teams|mentored|hiring|stakeholder|roadmap|leadership|architecture|delivery|built|created|owned/i.test(
              highlight,
            ),
          )
          .slice(0, 4),
      };
    })
    .slice(0, 6);

  return {
    question,
    role_summary: roleSummary,
    stories: unique(storyTypes)
      .slice(0, 4)
      .map((type) => ({ type, text: getInterviewStory(type) })),
    projects,
    experience,
    skills: careerData.skills,
    public_positioning: careerData.positioning,
  };
}

function answerProjectQuestion(question: string): string | undefined {
  const normalized = normalize(question);
  const matchedTheme = (Object.keys(themeLabels) as ProjectTheme[]).find(
    (theme) => includesKeyword(normalized, theme.replace("_", " ")),
  );
  const directProject = careerData.projects.find((project) =>
    includesKeyword(normalized, project.name),
  );
  const projects = directProject
    ? [directProject]
    : matchedTheme
      ? careerData.projects.filter((project) =>
          project.themes.includes(matchedTheme),
        )
      : [];
  if (projects.length === 0) return undefined;

  return projects
    .slice(0, 3)
    .map(
      (project) =>
        `${project.name}: ${project.summary} Brian's role: ${project.role} Impact: ${project.impact} Interview angle: ${project.interview_angle}`,
    )
    .join("\n\n");
}

function answerSkillQuestion(question: string): string | undefined {
  if (
    !/skill|stack|technology|tech|tool|language|framework|cloud|ops|data/.test(
      normalize(question),
    )
  )
    return undefined;
  return Object.entries(careerData.skills)
    .map(
      ([category, skills]) =>
        `${category.replaceAll("_", " ")}: ${skills.join(", ")}`,
    )
    .join("\n");
}

function answerLeadershipQuestion(question: string): string | undefined {
  if (
    !/(lead|leader|leading|managed|manager|management|team|teams|mentor|hiring|director|vp)/.test(
      normalize(question),
    )
  ) {
    return undefined;
  }

  return [
    "Yes. Brian has led teams in several different modes, which is more useful than one tidy management title.",
    "",
    "- At Beyond Finance, he was an Engineering Manager leading roadmap delivery, mentoring engineers, recruiting, code review discipline, and operational rigor in regulated fintech.",
    "- At Maryland Department of Labor, he led engineering and product work for a greenfield Paid Family and Medical Leave application while managing senior stakeholder relationships.",
    "- At 4810 Consulting, he led teams of 2 to 25 delivering full-stack Rails applications and APIs for clients including Rosetta Stone, Finalsite, Matalan Direct, Sonic Healthcare, and startups.",
    "- At Take the Interview, he helped build a fully remote team of 15 across engineering, design, and QA.",
    "- At Apple, he led source-control modernization and build/release infrastructure work across major creative applications.",
    "",
    "The short version: yes, and his leadership has usually been close to the work: product judgment, architecture, delivery habits, and team clarity.",
  ].join("\n");
}

function answerExecutiveQuestion(question: string): string | undefined {
  if (
    !/(executive|executives|senior leadership|stakeholder|stakeholders|c[- ]?suite|leadership team|dirigeants|cadres|führungskräfte|directie|leidinggevenden|ejecutivos|executius)/i.test(
      question,
    )
  ) {
    return undefined;
  }

  return [
    "Yes. Brian works well with executives and senior stakeholders because he can translate ambiguous business goals into technical plans without losing the operational details.",
    "",
    "- At the Maryland Department of Labor, he managed technical requirements and stakeholder relationships with senior State of Maryland leadership around compliance, customer experience, and financial processes.",
    "- At Apple, he led source-control modernization, CI/CD, build infrastructure, and release operations across major creative applications where many teams depended on reliable execution.",
    "- At Beyond Finance, he aligned engineering roadmap delivery with business goals in regulated fintech operations.",
    "- As a consultant and founder, he has repeatedly worked in rooms where product, engineering, customer, and business constraints all had to be reconciled.",
    "",
    "The useful signal is not just that he can communicate upward. It is that he can run the room, keep the architecture honest, and turn executive intent into shipped software.",
  ].join("\n");
}

function answerGapQuestion(question: string): string | undefined {
  if (
    !/(gap|gaps|risk|risks|concern|concerns|weak|weakness|weaknesses|missing|caveat|caveats)/.test(
      normalize(question),
    )
  ) {
    return undefined;
  }

  const match = matchJobDescription(question);
  return [
    "Possible gaps to validate in interview:",
    ...match.possible_gaps.map((gap) => `- ${gap}`),
    "- For AI-heavy roles, the career data shows AI/ML human evaluation workflows, RAG tools, and agentic AI interest; the interview should validate exactly how much current production LLM platform ownership the team needs.",
    "",
    "No public compensation answer is included here; that is a great thing to discuss with Brian.",
  ].join("\n");
}

function answerExperienceQuestion(question: string): string | undefined {
  const normalized = normalize(question);
  const job = careerData.experience.find((entry) =>
    includesKeyword(normalized, entry.company),
  );
  if (!job) return undefined;
  return `${job.company}, ${job.title} (${job.start} - ${job.end}): ${job.highlights.join(" ")}`;
}

export function askBrianCareerDeterministic(question: string): string {
  const normalized = normalize(question);

  if (isLogisticsQuestion(question)) {
    return interviewRouteAnswer(question);
  }

  if (/(phone|cell|mobile)/.test(normalized)) {
    return "Brian's phone number is intentionally not included in this public career data. That's a great question to ask Brian! Do you want to schedule an interview?";
  }

  if (/(contact|email|linkedin|github|links|reach)/.test(normalized)) {
    return "Absolutely. I can send Brian a note. What name, email, and company should I pass along?";
  }

  const gapAnswer = answerGapQuestion(question);
  if (gapAnswer) return gapAnswer;

  const executiveAnswer = answerExecutiveQuestion(question);
  if (executiveAnswer) return executiveAnswer;

  if (/(best role|fit|role|title|hire|why should|why talk)/.test(normalized)) {
    const roleAnswer = answerRoleQuestion(question);
    if (roleAnswer) return roleAnswer;
  }

  const leadershipAnswer = answerLeadershipQuestion(question);
  if (leadershipAnswer) return leadershipAnswer;

  const requestedStories = (
    Object.keys(careerData.stories) as QuestionType[]
  ).filter((storyType) =>
    includesKeyword(normalized, storyType.replace("_", " ")),
  );
  if (
    /(lead|leader|leading|managed|manager|management|team|teams|mentor|hiring|director|vp)/.test(
      normalized,
    )
  ) {
    requestedStories.push("leadership");
  }
  if (/(own|owner|ownership|accountable|accountability)/.test(normalized)) {
    requestedStories.push("ownership");
  }
  if (/(ambiguous|ambiguity|messy|unclear|undefined)/.test(normalized)) {
    requestedStories.push("ambiguity");
  }
  if (requestedStories.length > 0) {
    return unique(requestedStories)
      .slice(0, 3)
      .map(
        (storyType) =>
          `${storyType.replace("_", " ")}: ${getInterviewStory(storyType)}`,
      )
      .join("\n\n");
  }

  if (
    /(story|example|project|evidence|show|prove|tell me about)/.test(normalized)
  ) {
    const projectAnswer = answerProjectQuestion(question);
    if (projectAnswer) return projectAnswer;
  }

  const skillAnswer = answerSkillQuestion(question);
  if (skillAnswer) return skillAnswer;

  const experienceAnswer = answerExperienceQuestion(question);
  if (experienceAnswer) return experienceAnswer;

  const roleAnswer = answerRoleQuestion(question);
  if (roleAnswer) return roleAnswer;

  const projectAnswer = answerProjectQuestion(question);
  if (projectAnswer) return projectAnswer;

  const matchedFacts = [
    ...careerData.positioning,
    ...careerData.experience.flatMap((job) =>
      job.highlights.map((highlight) => `${job.company}: ${highlight}`),
    ),
    ...careerData.projects.map(
      (project) => `${project.name}: ${project.summary} ${project.impact}`,
    ),
  ].filter((fact) =>
    normalize(question)
      .split(/[^a-z0-9.+/#-]+/)
      .filter((word) => word.length > 4)
      .some((word) => includesKeyword(fact, word)),
  );

  if (matchedFacts.length > 0) {
    return unique(matchedFacts).slice(0, 5).join("\n");
  }

  return "I don't have that in the career data. That is a great question to ask Brian directly in an interview.";
}

function askBrianCareerFastPath(question: string): string | undefined {
  const normalized = normalize(question);

  if (isLogisticsQuestion(question)) {
    return interviewRouteAnswer(question);
  }

  if (/(phone|cell|mobile)/.test(normalized)) {
    return "Brian's phone number is intentionally not included in this public career data. That's a great question to ask Brian! Do you want to schedule an interview?";
  }

  if (/(contact|email|linkedin|github|links|reach)/.test(normalized)) {
    return "Absolutely. I can send Brian a note. What name, email, and company should I pass along?";
  }

  const gapAnswer = answerGapQuestion(question);
  if (gapAnswer) return gapAnswer;

  const executiveAnswer = answerExecutiveQuestion(question);
  if (executiveAnswer) return executiveAnswer;

  if (
    /(team|teams|managed|manager|management|mentor|mentoring|hiring|experience leading|led teams|leading teams|lead people)/.test(
      normalized,
    )
  ) {
    return answerLeadershipQuestion(question);
  }

  return undefined;
}

export async function askBrianCareerSmart(question: string): Promise<string> {
  const fastPathAnswer = askBrianCareerFastPath(question);
  if (fastPathAnswer) {
    return fastPathAnswer;
  }

  const evidence = retrieveCareerEvidence(question);
  const brainFacts = await getRelevantBrainFacts(question);
  if (brainFacts.length > 0) {
    evidence.brain_facts = brainFacts.map((fact) => ({
      topic: fact.topic,
      question: fact.question,
      answer: fact.answer,
      source: fact.source,
      created_at: fact.createdAt,
    }));
  }
  const aiAnswer = await synthesizeCareerAnswer(question, evidence);

  if (aiAnswer) {
    return aiAnswer;
  }

  return askBrianCareerDeterministic(question);
}

export function demoQuestions(): string[] {
  return [
    "Is Brian a fit for an AI Platform Leadership role?",
    "What evidence shows Brian can build serious product software?",
    "Summarize Brian for a Staff Rails Engineer role.",
    "Executive, Manager, or Individual Contributor?",
    "Why should a founder talk to Brian?",
  ];
}
