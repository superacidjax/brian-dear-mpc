import { randomUUID } from "node:crypto";
import { enqueueOrRun } from "./asyncJobs.js";
import {
  askBrianCareerSmart,
  matchJobDescriptionWithLearning,
} from "./careerEngine.js";
import { resolveJobDescriptionInput } from "./jobInput.js";

export interface ChatResponse {
  conversationId: string;
  kind: "answer" | "job_match";
  text: string;
  fit?: {
    score: number;
    label: "Great Fit" | "Good Fit" | "Low Fit";
    tone: "good" | "ok" | "low";
    reason: string;
    sourceUrl?: string;
    jobDescription: string;
  };
  suggestContact: boolean;
}

type FitLabel = NonNullable<ChatResponse["fit"]>["label"];
type FitTone = NonNullable<ChatResponse["fit"]>["tone"];

function logChatBestEffort(job: Parameters<typeof enqueueOrRun>[0]): void {
  void enqueueOrRun(job).catch((error) => {
    console.warn(
      JSON.stringify({
        event: "public_chat_log_failed",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  });
}

function looksLikeJobDescription(message: string): boolean {
  const trimmed = message.trim();
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/job description/i.test(trimmed)) return true;
  if (
    /\b(responsibilities|qualifications|requirements)\b/i.test(trimmed) &&
    /\b(role|candidate|experience|hiring|job)\b/i.test(trimmed)
  )
    return true;
  if (
    /\b(engineer|engineering|developer|director|vp|head of|manager|lead|teacher|retail|warehouse|designer|analyst|architect)\b/i.test(
      trimmed,
    ) &&
    /\b(requires|responsibilities|qualifications|application|owning|own|lead|develop|manage|hiring|role|position|for|building|improving|mentoring|using)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (trimmed.length < 280) return false;

  const jobSignals = [
    /job description/i,
    /\bresponsibilities\b/i,
    /\bqualifications?\b/i,
    /\brequirements?\b/i,
    /\bcompensation\b/i,
    /\bbenefits\b/i,
    /\bwe'?re hiring\b/i,
    /\bthe role\b/i,
    /\bcandidate\b/i,
    /\bexperience\b/i,
  ];

  return jobSignals.filter((pattern) => pattern.test(trimmed)).length >= 2;
}

function fitLabel(score: number): FitLabel {
  if (score >= 75) return "Great Fit";
  if (score >= 45) return "Good Fit";
  return "Low Fit";
}

function fitTone(score: number): FitTone {
  if (score >= 75) return "good";
  if (score >= 45) return "ok";
  return "low";
}

function looksLikeContactIntent(message: string): boolean {
  return /\b(contact|reach|connect|talk to brian|speak with brian|schedule|interview|email brian|hire brian|get in touch|follow up|next step)\b/i.test(
    message,
  );
}

function asksLocationOrCompensation(message: string): boolean {
  return /\b(location|located|where does brian live|where is brian|salary|compensation|pay|rate|hourly|contract rate|expectations)\b/i.test(
    message,
  );
}

export async function handleCareerChatMessage(input: {
  message: string;
  conversationId?: string;
}): Promise<ChatResponse> {
  const message = input.message.trim();
  const conversationId = input.conversationId || randomUUID();

  if (looksLikeContactIntent(message)) {
    const text =
      "Absolutely. I can send Brian a note. What name, email, and company should I pass along?";
    logChatBestEffort({
      type: "public_chat_log",
      conversationId,
      userMessage: message,
      assistantSummary: text,
      kind: "contact_prompt",
    });

    return {
      conversationId,
      kind: "answer",
      text,
      suggestContact: true,
    };
  }

  if (asksLocationOrCompensation(message)) {
    const text =
      "That's a great question to ask Brian! Do you want to schedule an interview?";
    logChatBestEffort({
      type: "public_chat_log",
      conversationId,
      userMessage: message,
      assistantSummary: text,
      kind: "handoff_prompt",
    });

    return {
      conversationId,
      kind: "answer",
      text,
      suggestContact: true,
    };
  }

  if (looksLikeJobDescription(message)) {
    const { text: jobDescription, sourceUrl } =
      await resolveJobDescriptionInput(message);
    const match = await matchJobDescriptionWithLearning(jobDescription);
    const score = match.fit_score;
    const label = fitLabel(score);
    const reason =
      match.possible_gaps[0] ??
      match.recommended_positioning[0] ??
      "This assessment is based on Brian's career fit for this role.";
    const text =
      score >= 75
        ? "This looks like a strong Brian-shaped problem. Worth a real conversation."
        : score >= 45
          ? "There are some matching signals, but this is not an obvious slam dunk."
          : "This does not look like the right lane for Brian.";

    const response: ChatResponse = {
      conversationId,
      kind: "job_match",
      text,
      fit: {
        score,
        label,
        tone: fitTone(score),
        reason,
        sourceUrl,
        jobDescription,
      },
      suggestContact: score >= 75,
    };

    logChatBestEffort({
      type: "public_chat_log",
      conversationId,
      userMessage: message,
      assistantSummary: `${text} Score: ${score}. ${label} ${reason}`,
      kind: "job_match",
      score,
    });

    return response;
  }

  const answer = await askBrianCareerSmart(message);
  const suggestContact =
    /(schedule|interview|talk to brian|contact|reach out|hire|available|availability|next step)/i.test(
      message,
    );
  logChatBestEffort({
    type: "public_chat_log",
    conversationId,
    userMessage: message,
    assistantSummary: answer,
    kind: "answer",
  });

  return {
    conversationId,
    kind: "answer",
    text: answer,
    suggestContact,
  };
}
