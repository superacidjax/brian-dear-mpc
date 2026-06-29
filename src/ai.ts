import type { CareerEvidence } from "./careerEngine.js";

type Provider = "auto" | "ollama" | "openai" | "bedrock" | "off";

interface TextGenerationInput {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.CAREER_AI_TIMEOUT_MS ?? 4000);
const DEFAULT_OLLAMA_MODEL = "qwen3:4b";

function providerPreference(): Provider {
  const value = (process.env.CAREER_AI_PROVIDER ?? "off").toLowerCase();
  if (
    value === "ollama" ||
    value === "openai" ||
    value === "bedrock" ||
    value === "off"
  )
    return value;
  return "auto";
}

function languageInstruction(question: string): string {
  const normalized = question.toLowerCase();
  if (
    /[¿¡]/.test(question) ||
    /\b(salario|sueldo|ubicaci[oó]n|entrevista|ejecutivos|trabaja bien)\b/.test(
      normalized,
    )
  ) {
    return "Detected question language: Spanish. You must answer in Spanish.";
  }
  if (
    /\b(salari|ubicaci[oó]|entrevista|executius|treballa b[eé])\b/.test(
      normalized,
    )
  ) {
    return "Detected question language: Catalan. You must answer in Catalan.";
  }
  if (
    /\b(salaire|localisation|entretien|dirigeants|cadres|travaille bien)\b/.test(
      normalized,
    )
  ) {
    return "Detected question language: French. You must answer in French.";
  }
  if (
    /\b(gehalt|standort|vorstellungsgespr[aä]ch|f[uü]hrungskr[aä]fte|arbeitet gut)\b/.test(
      normalized,
    )
  ) {
    return "Detected question language: German. You must answer in German.";
  }
  if (
    /\b(salaris|loon|locatie|gesprek|sollicitatiegesprek|directie|leidinggevenden)\b/.test(
      normalized,
    )
  ) {
    return "Detected question language: Dutch. You must answer in Dutch.";
  }
  return "Detected question language: English. You must answer in English.";
}

function buildPrompt(question: string, evidence: CareerEvidence): string {
  return [
    "Answer a recruiter or hiring-manager question about Brian Dear.",
    "Output plain text only. Do not output JSON, YAML, Markdown tables, placeholders, or resume-schema objects.",
    "Answer in the same language as the question. Supported languages include English, Spanish, Catalan, French, German, and Dutch.",
    languageInstruction(question),
    "Write in third person. Be direct, specific, human, confident, and a little memorable. No profanity.",
    "Use only the supplied career evidence. Do not invent claims, dates, employers, metrics, or private contact details.",
    "If asked about gaps, risks, concerns, or weaknesses, answer candidly with supported caveats instead of turning it into a generic pitch.",
    "If asked about salary, compensation, pay, location, relocation, remote work, or time zone, answer exactly with: \"That's a great question to ask Brian! Do you want to schedule an interview?\" Translate that sentence into the question's language when appropriate.",
    "If asked for phone, location, compensation, or direct contact details, say that is a great question to ask Brian and offer to send Brian a note through the chat.",
    "Do not use phrases like 'grounded answer', 'based on the data', or 'provided career data'.",
    "Do not say 'I' or pretend to be Brian.",
    'If the answer is not supported, say: "That is a great question to ask Brian directly in an interview."',
    "Keep the answer under 180 words unless the question asks for a list.",
    "",
    `Question: ${question}`,
    "",
    "Career evidence:",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function cleanAnswer(answer: string): string | undefined {
  const cleaned = answer
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
  if (!cleaned) return undefined;
  if (cleaned.length > 2400) return undefined;
  if (/^\s*[{[]/.test(cleaned)) return undefined;
  if (/<NAME>|company_name|"summary"|"experience"|```/i.test(cleaned))
    return undefined;
  if (/\bI\s+(have|am|built|led|worked|created|managed)\b/i.test(cleaned))
    return undefined;
  if (
    /provided information|provided data|career evidence|based on the/i.test(
      cleaned,
    )
  )
    return undefined;
  if (/grounded answer/i.test(cleaned)) {
    return cleaned
      .replace(/grounded answer( from Brian's career data)?:?/gi, "")
      .trim();
  }
  return cleaned;
}

async function askOllama(
  question: string,
  evidence: CareerEvidence,
): Promise<string | undefined> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
  const prompt = buildPrompt(question, evidence);

  const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "30m",
      think: process.env.OLLAMA_THINK === "true",
      messages: [
        {
          role: "system",
          content:
            "You write concise, truthful, recruiter-facing prose from supplied facts only. Plain text only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      options: {
        temperature: 0.15,
        num_ctx: Number(process.env.OLLAMA_NUM_CTX ?? 4096),
        num_predict: Number(process.env.OLLAMA_NUM_PREDICT ?? 180),
      },
    }),
  });

  if (!response.ok) return undefined;
  const payload = (await response.json()) as { message?: { content?: string } };
  return cleanAnswer(payload.message?.content ?? "");
}

async function askOllamaText(
  input: TextGenerationInput,
): Promise<string | undefined> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;

  const response = await fetchWithTimeout(
    `${baseUrl}/api/chat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "30m",
        think: process.env.OLLAMA_THINK === "true",
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
        options: {
          temperature: input.temperature ?? 0.5,
          num_ctx: Number(process.env.OLLAMA_NUM_CTX ?? 4096),
          num_predict:
            input.maxTokens ?? Number(process.env.OLLAMA_NUM_PREDICT ?? 220),
        },
      }),
    },
    input.timeoutMs,
  );

  if (!response.ok) return undefined;
  const payload = (await response.json()) as { message?: { content?: string } };
  return cleanGeneratedText(payload.message?.content ?? "");
}

export async function warmCareerAiModel(): Promise<void> {
  const provider = providerPreference();
  if (provider !== "ollama" && provider !== "auto") return;

  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;

  try {
    await fetchWithTimeout(
      `${baseUrl}/api/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: "",
          stream: false,
          keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "30m",
          options: {
            num_predict: 1,
            num_ctx: Number(process.env.OLLAMA_NUM_CTX ?? 4096),
          },
        }),
      },
      Number(process.env.OLLAMA_WARM_TIMEOUT_MS ?? 30000),
    );
  } catch {
    // Warming is opportunistic. Normal request fallback still handles unavailable AI.
  }
}

async function askOpenAI(
  question: string,
  evidence: CareerEvidence,
): Promise<string | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;

  const model = process.env.OPENAI_MODEL;
  if (!model) return undefined;
  const prompt = buildPrompt(question, evidence);

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        max_output_tokens: 320,
        store: false,
      }),
    },
    Number(process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  );

  if (!response.ok) return undefined;
  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };

  const outputText =
    payload.output_text ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter(Boolean)
      .join("\n");

  return cleanAnswer(outputText ?? "");
}

async function askOpenAIText(
  input: TextGenerationInput,
): Promise<string | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;

  const model = process.env.OPENAI_MODEL;
  if (!model) return undefined;

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
        max_output_tokens: input.maxTokens ?? 320,
        temperature: input.temperature ?? 0.5,
        store: false,
      }),
    },
    input.timeoutMs ??
      Number(process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  );

  if (!response.ok) return undefined;
  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const outputText =
    payload.output_text ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter(Boolean)
      .join("\n");

  return cleanGeneratedText(outputText ?? "");
}

async function askOpenAiCompatibleChat({
  apiKey,
  baseUrl,
  model,
  question,
  evidence,
  timeoutMs,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  question: string;
  evidence: CareerEvidence;
  timeoutMs: number;
}): Promise<string | undefined> {
  const prompt = buildPrompt(question, evidence);
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  const response = await fetchWithTimeout(
    `${normalizedBaseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You write concise, truthful, recruiter-facing prose from supplied facts only. Plain text only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.15,
        max_tokens: Number(process.env.COMPATIBLE_MAX_TOKENS ?? 500),
      }),
    },
    timeoutMs,
  );

  if (!response.ok) return undefined;
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };
  return cleanAnswer(
    payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.text ?? "",
  );
}

async function askOpenAiCompatibleText({
  apiKey,
  baseUrl,
  model,
  input,
  timeoutMs,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  input: TextGenerationInput;
  timeoutMs: number;
}): Promise<string | undefined> {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  const response = await fetchWithTimeout(
    `${normalizedBaseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
        temperature: input.temperature ?? 0.5,
        max_tokens:
          input.maxTokens ?? Number(process.env.COMPATIBLE_MAX_TOKENS ?? 500),
      }),
    },
    timeoutMs,
  );

  if (!response.ok) return undefined;
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };
  return cleanGeneratedText(
    payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.text ?? "",
  );
}

async function askBedrock(
  question: string,
  evidence: CareerEvidence,
): Promise<string | undefined> {
  const apiKey = process.env.BEDROCK_API_KEY;
  if (!apiKey) return undefined;

  return askOpenAiCompatibleChat({
    apiKey,
    baseUrl:
      process.env.BEDROCK_BASE_URL ??
      "https://bedrock-mantle.us-east-1.api.aws/v1",
    model: process.env.BEDROCK_MODEL ?? "openai.gpt-oss-20b",
    question,
    evidence,
    timeoutMs: Number(process.env.BEDROCK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  });
}

async function askBedrockText(
  input: TextGenerationInput,
): Promise<string | undefined> {
  const apiKey = process.env.BEDROCK_API_KEY;
  if (!apiKey) return undefined;

  return askOpenAiCompatibleText({
    apiKey,
    baseUrl:
      process.env.BEDROCK_BASE_URL ??
      "https://bedrock-mantle.us-east-1.api.aws/v1",
    model: process.env.BEDROCK_MODEL ?? "openai.gpt-oss-20b",
    input,
    timeoutMs:
      input.timeoutMs ??
      Number(process.env.BEDROCK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  });
}

function cleanGeneratedText(text: string): string | undefined {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!cleaned) return undefined;
  if (cleaned.length > 5000) return undefined;
  return cleaned;
}

export async function generateCareerText(
  input: TextGenerationInput,
): Promise<string | undefined> {
  const provider = providerPreference();
  if (provider === "off") return undefined;

  try {
    if (provider === "ollama") return await askOllamaText(input);
    if (provider === "openai") return await askOpenAIText(input);
    if (provider === "bedrock") return await askBedrockText(input);

    const bedrockText = await askBedrockText(input);
    if (bedrockText) return bedrockText;
    const ollamaText = await askOllamaText(input);
    if (ollamaText) return ollamaText;
    return await askOpenAIText(input);
  } catch {
    return undefined;
  }
}

export async function synthesizeCareerAnswer(
  question: string,
  evidence: CareerEvidence,
): Promise<string | undefined> {
  const provider = providerPreference();
  if (provider === "off") return undefined;

  try {
    if (provider === "ollama") return await askOllama(question, evidence);
    if (provider === "openai") return await askOpenAI(question, evidence);
    if (provider === "bedrock") return await askBedrock(question, evidence);

    const bedrockAnswer = await askBedrock(question, evidence);
    if (bedrockAnswer) return bedrockAnswer;
    const ollamaAnswer = await askOllama(question, evidence);
    if (ollamaAnswer) return ollamaAnswer;
    return await askOpenAI(question, evidence);
  } catch {
    return undefined;
  }
}
