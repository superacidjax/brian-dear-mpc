import crypto from "node:crypto";

interface ContactRequest {
  name: string;
  email: string;
  company?: string;
  message: string;
  jobDescription?: string;
}

type SlackBlock = Record<string, unknown>;
type SlackChannelKind =
  "brian" | "user_log" | "human_eval" | "mock_interview" | "interview_request";

const MAX_SLACK_TEXT_LENGTH = 3500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateForSlack(text: string): string {
  return text.length > MAX_SLACK_TEXT_LENGTH
    ? `${text.slice(0, MAX_SLACK_TEXT_LENGTH - 18)}\n...[truncated]`
    : text;
}

function slackChannelFor(kind: SlackChannelKind): string | undefined {
  if (kind === "user_log")
    return (
      process.env.SLACK_USER_LOG_CHANNEL_ID || process.env.SLACK_BRIAN_USER_ID
    );
  if (kind === "human_eval")
    return (
      process.env.SLACK_HUMAN_EVAL_CHANNEL_ID || process.env.SLACK_BRIAN_USER_ID
    );
  if (kind === "mock_interview")
    return (
      process.env.SLACK_MOCK_INTERVIEW_CHANNEL_ID ||
      process.env.SLACK_BRIAN_USER_ID
    );
  if (kind === "interview_request")
    return (
      process.env.SLACK_INTERVIEW_REQUEST_CHANNEL_ID ||
      process.env.SLACK_BRIAN_USER_ID
    );
  return process.env.SLACK_BRIAN_USER_ID;
}

export async function sendContactToSlack(
  contact: ContactRequest,
): Promise<{ sent: boolean; reason?: string }> {
  const lines = [
    "*Recruiter contact request from Brian Career MCP*",
    `*Name:* ${contact.name}`,
    `*Email:* ${contact.email}`,
    contact.company ? `*Company:* ${contact.company}` : "",
    `*Message:* ${contact.message}`,
    contact.jobDescription
      ? `*Job description excerpt:* ${contact.jobDescription.slice(0, 1200)}`
      : "",
  ].filter(Boolean);

  const botResult = await sendSlackBotMessage(
    lines.join("\n"),
    undefined,
    "interview_request",
  );
  return botResult.sent
    ? botResult
    : {
        sent: false,
        reason: botResult.reason ?? "Slack bot posting is not configured.",
      };
}

export function verifySlackSignature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret || !timestamp || !signature) return false;

  const requestAgeSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(requestAgeSeconds) || requestAgeSeconds > 60 * 5)
    return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto.createHmac("sha256", signingSecret).update(base).digest("hex")}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

export async function sendSlackBotMessage(
  text: string,
  blocks?: SlackBlock[],
  channelKind: SlackChannelKind = "brian",
): Promise<{ sent: boolean; ts?: string; reason?: string }> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channel = slackChannelFor(channelKind);
  if (!botToken || !channel) {
    return {
      sent: false,
      reason: "Slack bot token or destination channel is not configured.",
    };
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        text: truncateForSlack(text),
        blocks,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      ts?: string;
      error?: string;
    };
    if (payload.ok) {
      console.log(
        JSON.stringify({
          event: "slack_post_success",
          channelKind,
          ts: payload.ts,
        }),
      );
      return { sent: true, ts: payload.ts };
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      payload.error === "ratelimited";
    if (retryable && attempt < 3) {
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : attempt * 1000,
      );
      continue;
    }

    const reason = payload.error ?? `Slack returned ${response.status}.`;
    console.warn(
      JSON.stringify({
        event: "slack_post_failed",
        channelKind,
        reason,
        attempt,
      }),
    );
    return { sent: false, reason };
  }

  return { sent: false, reason: "Slack post failed after retries." };
}

export async function postSlackCommandFollowup(
  responseUrl: string | undefined,
  text: string,
): Promise<void> {
  if (!responseUrl) return;

  const response = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_type: "ephemeral",
      text: truncateForSlack(text),
    }),
  });

  if (!response.ok) {
    console.warn(
      JSON.stringify({
        event: "slack_command_followup_failed",
        status: response.status,
      }),
    );
  }
}

export async function logPublicChatToSlack(entry: {
  conversationId: string;
  userMessage: string;
  assistantSummary: string;
  kind: string;
  score?: number;
}): Promise<void> {
  const lines = [
    "*Public Career Agent conversation*",
    `*Conversation:* ${entry.conversationId}`,
    `*Kind:* ${entry.kind}`,
    typeof entry.score === "number" ? `*Score:* ${entry.score}` : "",
    `*User:* ${entry.userMessage.slice(0, 2500)}`,
    `*Agent:* ${entry.assistantSummary.slice(0, 2500)}`,
  ].filter(Boolean);

  await sendSlackBotMessage(lines.join("\n"), undefined, "user_log");
}
