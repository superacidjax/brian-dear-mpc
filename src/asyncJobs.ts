import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import {
  markInterviewQuestionSkipped,
  rateEvaluation,
  recordInterviewReply,
  sendNextEvaluation,
  sendNextInterviewQuestion,
  type EvaluationMode,
} from "./brain.js";
import {
  logPublicChatToSlack,
  postSlackCommandFollowup,
  sendContactToSlack,
} from "./slack.js";
import type { EvalRating } from "./brainStore.js";

type SlackChannelKind =
  "brian" | "user_log" | "human_eval" | "mock_interview" | "interview_request";

export type AsyncJob =
  | {
      type: "public_chat_log";
      conversationId: string;
      userMessage: string;
      assistantSummary: string;
      kind: string;
      score?: number;
    }
  | {
      type: "contact_request";
      conversationId: string;
      name: string;
      email: string;
      company?: string;
      message: string;
      jobDescription?: string;
    }
  | {
      type: "send_next_interview_question";
      responseUrl?: string;
    }
  | {
      type: "send_next_evaluation";
      mode?: EvaluationMode;
      responseUrl?: string;
    }
  | {
      type: "record_interview_reply";
      text: string;
      responseChannel?: SlackChannelKind;
    }
  | {
      type: "mark_interview_question_skipped";
      questionId: string;
      inappropriate: boolean;
    }
  | {
      type: "rate_evaluation";
      evaluationId: string;
      rating: EvalRating;
    };

let sqsClient: SQSClient | undefined;
let workerStopping = false;

function queueUrl(): string | undefined {
  return process.env.ASYNC_QUEUE_URL;
}

function sqs(): SQSClient {
  if (!sqsClient) {
    sqsClient = new SQSClient({});
  }
  return sqsClient;
}

function canUseQueue(): boolean {
  return Boolean(queueUrl());
}

export async function enqueueAsyncJob(job: AsyncJob): Promise<boolean> {
  const url = queueUrl();
  if (!url) return false;

  await sqs().send(
    new SendMessageCommand({
      QueueUrl: url,
      MessageBody: JSON.stringify(job),
    }),
  );
  return true;
}

export async function enqueueOrRun(job: AsyncJob): Promise<void> {
  if (canUseQueue()) {
    await enqueueAsyncJob(job);
    return;
  }

  await processAsyncJob(job);
}

export async function processAsyncJob(job: AsyncJob): Promise<void> {
  switch (job.type) {
    case "public_chat_log":
      await logPublicChatToSlack(job);
      return;
    case "contact_request":
      await sendContactToSlack(job);
      await logPublicChatToSlack({
        conversationId: job.conversationId,
        userMessage: `Contact request from ${job.name}${job.company ? ` at ${job.company}` : ""}.`,
        assistantSummary: "Sent contact request to Brian.",
        kind: "contact",
      });
      return;
    case "send_next_interview_question": {
      const result = await sendNextInterviewQuestion();
      await postSlackCommandFollowup(job.responseUrl, result);
      return;
    }
    case "send_next_evaluation": {
      const result = await sendNextEvaluation(job.mode);
      await postSlackCommandFollowup(job.responseUrl, result);
      return;
    }
    case "record_interview_reply":
      await recordInterviewReply(job.text);
      return;
    case "mark_interview_question_skipped":
      await markInterviewQuestionSkipped(job.questionId, job.inappropriate);
      return;
    case "rate_evaluation":
      await rateEvaluation(job.evaluationId, job.rating);
      return;
  }
}

export async function startAsyncWorker(): Promise<void> {
  const url = queueUrl();
  if (!url) {
    console.warn(
      JSON.stringify({
        event: "async_worker_disabled",
        reason: "ASYNC_QUEUE_URL is not configured",
      }),
    );
    return;
  }

  console.log(JSON.stringify({ event: "async_worker_started" }));

  while (!workerStopping) {
    try {
      const response = await sqs().send(
        new ReceiveMessageCommand({
          QueueUrl: url,
          MaxNumberOfMessages: 5,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 90,
        }),
      );

      for (const message of response.Messages ?? []) {
        if (!message.Body || !message.ReceiptHandle) continue;

        const job = JSON.parse(message.Body) as AsyncJob;
        await processAsyncJob(job);
        await sqs().send(
          new DeleteMessageCommand({
            QueueUrl: url,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "async_worker_error",
          message:
            error instanceof Error ? error.message : "Unknown worker error",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }
}

export function stopAsyncWorker(): void {
  workerStopping = true;
}
