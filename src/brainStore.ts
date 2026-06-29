import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

export type InterviewStatus = "pending" | "asked" | "answered" | "skipped";
export type EvalRating = "good" | "bad" | "incomplete" | "too_high" | "too_low";
export type EvalStatus = "awaiting_rating" | "rated";

export interface InterviewQuestionItem {
  id: string;
  entityType: "interview_question";
  question: string;
  topic: string;
  status: InterviewStatus;
  slackTs?: string;
  createdAt: string;
  updatedAt: string;
  answeredAt?: string;
}

export interface BrainFactItem {
  id: string;
  entityType: "brain_fact";
  topic: string;
  question: string;
  answer: string;
  language: string;
  source: "brian_slack_interview" | "brian_human_eval_approved_answer";
  status: "approved";
  createdAt: string;
  updatedAt: string;
}

export interface AnswerEvaluationItem {
  id: string;
  entityType: "answer_evaluation";
  evalKind?: "answer" | "job_score";
  generatedQuestion: string;
  generatedAnswer: string;
  jobDescription?: string;
  fitScore?: number;
  fitLabel?: string;
  status: EvalStatus;
  rating?: EvalRating;
  calibrationSignal?: "confirmed" | "too_high" | "too_low" | "incomplete";
  scoreAdjustment?: number;
  calibrationReason?: string;
  slackTs?: string;
  createdAt: string;
  updatedAt: string;
  ratedAt?: string;
}

type BrainItem = InterviewQuestionItem | BrainFactItem | AnswerEvaluationItem;

interface BrainFile {
  items: BrainItem[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function storeMode(): "dynamodb" | "file" {
  return process.env.BRAIN_STORE === "dynamodb" &&
    Boolean(process.env.BRAIN_TABLE_NAME)
    ? "dynamodb"
    : "file";
}

function tableName(): string {
  return process.env.BRAIN_TABLE_NAME ?? "brian-dear-career-brain-prod";
}

function entityIndexName(): string | undefined {
  return process.env.BRAIN_ENTITY_INDEX_NAME;
}

function filePath(): string {
  return (
    process.env.BRAIN_FILE_PATH ??
    path.resolve(process.cwd(), "output/brain-store.json")
  );
}

let dynamoDoc: DynamoDBDocumentClient | undefined;

function dynamo(): DynamoDBDocumentClient {
  if (!dynamoDoc) {
    dynamoDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return dynamoDoc;
}

async function readFileStore(): Promise<BrainFile> {
  try {
    return JSON.parse(await readFile(filePath(), "utf8")) as BrainFile;
  } catch {
    return { items: [] };
  }
}

async function writeFileStore(store: BrainFile): Promise<void> {
  await mkdir(path.dirname(filePath()), { recursive: true });
  await writeFile(filePath(), `${JSON.stringify(store, null, 2)}\n`);
}

async function listItems<T extends BrainItem>(
  entityType: T["entityType"],
): Promise<T[]> {
  if (storeMode() === "dynamodb") {
    const indexName = entityIndexName();
    if (indexName) {
      const response = await dynamo().send(
        new QueryCommand({
          TableName: tableName(),
          IndexName: indexName,
          KeyConditionExpression: "entityType = :entityType",
          ExpressionAttributeValues: {
            ":entityType": entityType,
          },
        }),
      );
      return (response.Items ?? []) as T[];
    }

    const response = await dynamo().send(
      new ScanCommand({
        TableName: tableName(),
        FilterExpression: "entityType = :entityType",
        ExpressionAttributeValues: {
          ":entityType": entityType,
        },
      }),
    );
    return ((response.Items ?? []) as T[]).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  const store = await readFileStore();
  return store.items
    .filter((item): item is T => item.entityType === entityType)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function putItem(item: BrainItem): Promise<void> {
  if (storeMode() === "dynamodb") {
    await dynamo().send(
      new PutCommand({
        TableName: tableName(),
        Item: item,
      }),
    );
    return;
  }

  const store = await readFileStore();
  store.items = [
    ...store.items.filter(
      (existing) =>
        !(existing.entityType === item.entityType && existing.id === item.id),
    ),
    item,
  ];
  await writeFileStore(store);
}

export async function listInterviewQuestions(): Promise<
  InterviewQuestionItem[]
> {
  return listItems<InterviewQuestionItem>("interview_question");
}

export async function listBrainFacts(): Promise<BrainFactItem[]> {
  return listItems<BrainFactItem>("brain_fact");
}

export async function listAnswerEvaluations(): Promise<AnswerEvaluationItem[]> {
  return listItems<AnswerEvaluationItem>("answer_evaluation");
}

export async function saveInterviewQuestion(
  item: InterviewQuestionItem,
): Promise<void> {
  await putItem({ ...item, updatedAt: nowIso() });
}

export async function saveBrainFact(item: BrainFactItem): Promise<void> {
  await putItem({ ...item, updatedAt: nowIso() });
}

export async function saveAnswerEvaluation(
  item: AnswerEvaluationItem,
): Promise<void> {
  await putItem({ ...item, updatedAt: nowIso() });
}

export function newBrainId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function newTimestamp(): string {
  return nowIso();
}
