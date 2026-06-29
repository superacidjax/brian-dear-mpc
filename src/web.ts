import express from "express";
import type { NextFunction, Request, Response } from "express";
import compression from "compression";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  enqueueOrRun,
  startAsyncWorker,
  stopAsyncWorker,
} from "./asyncJobs.js";
import { warmCareerAiModel } from "./ai.js";
import { brainStatus } from "./brain.js";
import { handleCareerChatMessage } from "./chatService.js";
import { demoQuestions } from "./careerEngine.js";
import { resolveJobDescriptionInput } from "./jobInput.js";
import { generateCustomizedResumePdf } from "./resumeService.js";
import { verifySlackSignature } from "./slack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
const port = Number(process.env.PORT ?? 4173);
const publicDir = path.resolve(__dirname, "../public");

interface RawBodyRequest extends Request {
  rawBody?: string;
}

function captureRawBody(
  req: RawBodyRequest,
  _res: Response,
  buf: Buffer,
): void {
  req.rawBody = buf.toString("utf8");
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "Admin endpoints are not configured." });
      return;
    }

    next();
    return;
  }

  const provided = req.header("x-admin-token");
  if (provided !== token) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  next();
}

function verifySlackRequest(req: RawBodyRequest, res: Response): boolean {
  const ok = verifySlackSignature(
    req.rawBody ?? "",
    req.header("x-slack-request-timestamp"),
    req.header("x-slack-signature"),
  );
  if (!ok) {
    res.status(401).json({ error: "Invalid Slack signature." });
  }
  return ok;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function structuredDataScriptHash(): string | undefined {
  try {
    const html = readFileSync(path.join(publicDir, "index.html"), "utf8");
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    if (!match) return undefined;
    return `'sha256-${crypto.createHash("sha256").update(match[1]).digest("base64")}'`;
  } catch {
    return undefined;
  }
}

function requireTrustedOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const secret = process.env.ORIGIN_SHARED_SECRET;
  if (
    process.env.NODE_ENV === "production" &&
    secret &&
    req.path !== "/healthz" &&
    req.header("x-origin-verify") !== secret
  ) {
    res.status(403).json({ error: "Forbidden." });
    return;
  }

  next();
}

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((req, res, next) => {
  const canonicalHost = process.env.CANONICAL_HOST ?? "www.briandear.ai";
  const apexHost = process.env.APEX_HOST ?? "briandear.ai";
  const host = req.hostname.toLowerCase();
  if (host === apexHost && canonicalHost) {
    res.redirect(301, `https://${canonicalHost}${req.originalUrl}`);
    return;
  }
  next();
});
app.use(requireTrustedOrigin);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", structuredDataScriptHash()].filter(
          (item): item is string => Boolean(item),
        ),
        styleSrc: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(compression());
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 80,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/healthz",
  }),
);
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use(express.json({ limit: "96kb", verify: captureRawBody }));
app.use(
  express.urlencoded({
    extended: false,
    limit: "96kb",
    verify: captureRawBody,
  }),
);
app.use(
  express.static(publicDir, {
    etag: true,
    maxAge: "1h",
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader(
          "Cache-Control",
          "public, max-age=3600, stale-while-revalidate=86400",
        );
      }
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  }),
);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/samples", (_req, res) => {
  res.json({ questions: demoQuestions() });
});

app.post("/api/chat", async (req, res) => {
  try {
    const message =
      typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const conversationId =
      typeof req.body?.conversationId === "string"
        ? req.body.conversationId
        : undefined;
    if (!message) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    res.json(await handleCareerChatMessage({ message, conversationId }));
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Could not answer that message." });
  }
});

app.post("/api/resume", async (req, res) => {
  try {
    const jobInput =
      typeof req.body?.jobDescription === "string"
        ? req.body.jobDescription.trim()
        : "";
    const { text: jobDescription } = await resolveJobDescriptionInput(jobInput);
    if (jobDescription.length < 20) {
      res.status(400).json({
        error: "Paste a job description or public job-posting link first.",
      });
      return;
    }

    const pdf = await generateCustomizedResumePdf(jobDescription);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Brian_Dear_Customized_Resume.pdf"',
    );
    res.send(pdf);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not generate the resume PDF." });
  }
});

app.post("/api/contact", async (req, res) => {
  try {
    const name = truncate(
      typeof req.body?.name === "string" ? req.body.name.trim() : "",
      120,
    );
    const email = truncate(
      typeof req.body?.email === "string" ? req.body.email.trim() : "",
      254,
    );
    const message = truncate(
      typeof req.body?.message === "string" ? req.body.message.trim() : "",
      2400,
    );
    const company = truncate(
      typeof req.body?.company === "string" ? req.body.company.trim() : "",
      160,
    );
    const jobDescription = truncate(
      typeof req.body?.jobDescription === "string"
        ? req.body.jobDescription.trim()
        : "",
      4000,
    );
    const conversationId = truncate(
      typeof req.body?.conversationId === "string"
        ? req.body.conversationId.trim()
        : "contact",
      120,
    );

    if (!name || !isValidEmail(email) || !message) {
      res
        .status(400)
        .json({ error: "Name, a valid email, and message are required." });
      return;
    }

    await enqueueOrRun({
      type: "contact_request",
      conversationId,
      name,
      email,
      company,
      message,
      jobDescription,
    });

    res.json({ sent: true, queued: true });
  } catch (error) {
    console.error(error);
    res.status(503).json({ error: "Could not send that request right now." });
  }
});

app.get("/api/brain/status", requireAdmin, async (_req, res) => {
  res.json(await brainStatus());
});

app.post("/api/brain/next-question", requireAdmin, async (_req, res) => {
  try {
    await enqueueOrRun({ type: "send_next_interview_question" });
    res.json({ queued: true });
  } catch (error) {
    console.error(error);
    res.status(503).json({ error: "Could not queue the next question." });
  }
});

app.post("/api/brain/next-eval", requireAdmin, async (_req, res) => {
  try {
    await enqueueOrRun({ type: "send_next_evaluation" });
    res.json({ queued: true });
  } catch (error) {
    console.error(error);
    res.status(503).json({ error: "Could not queue the next eval." });
  }
});

app.post("/slack/commands", async (req: RawBodyRequest, res) => {
  if (!verifySlackRequest(req, res)) return;

  const command =
    typeof req.body?.command === "string" ? req.body.command.trim() : "";
  const text =
    typeof req.body?.text === "string"
      ? req.body.text.trim().toLowerCase()
      : "";
  const channelId =
    typeof req.body?.channel_id === "string" ? req.body.channel_id.trim() : "";
  const responseUrl =
    typeof req.body?.response_url === "string"
      ? req.body.response_url
      : undefined;
  const mockInterviewChannelId = process.env.SLACK_MOCK_INTERVIEW_CHANNEL_ID;
  const humanEvalChannelId = process.env.SLACK_HUMAN_EVAL_CHANNEL_ID;
  console.log(
    JSON.stringify({
      event: "slack_command_received",
      command,
      text,
      channelId,
    }),
  );

  if (command === "/brian-question") {
    if (mockInterviewChannelId && channelId !== mockInterviewChannelId) {
      res.json({
        response_type: "ephemeral",
        text: "Use `/brian-question` in the mock interview channel.",
      });
      return;
    }

    res.json({
      response_type: "ephemeral",
      text: "Sending the next mock interview question...",
    });
    try {
      await enqueueOrRun({ type: "send_next_interview_question", responseUrl });
      console.log(JSON.stringify({ event: "slack_command_queued", command }));
    } catch (error) {
      console.error(error);
    }
    return;
  }

  if (command === "/brian-eval") {
    if (humanEvalChannelId && channelId !== humanEvalChannelId) {
      res.json({
        response_type: "ephemeral",
        text: "Use `/brian-eval` in the human evaluation channel.",
      });
      return;
    }

    const mode =
      text === "job" || text === "fit" || text === "score" || text === "job fit"
        ? "job_score"
        : text === "answer"
          ? "answer"
          : "auto";
    res.json({
      response_type: "ephemeral",
      text:
        mode === "job_score"
          ? "Sending a job-fit scoring eval..."
          : mode === "answer"
            ? "Sending an answer-quality eval..."
            : "Sending the next human eval...",
    });
    try {
      await enqueueOrRun({ type: "send_next_evaluation", mode, responseUrl });
      console.log(
        JSON.stringify({ event: "slack_command_queued", command, mode }),
      );
    } catch (error) {
      console.error(error);
    }
    return;
  }

  res.json({
    response_type: "ephemeral",
    text: "Unknown command. Use `/brian-question`, `/brian-eval`, `/brian-eval job`, or `/brian-eval answer`.",
  });
});

app.post("/slack/events", async (req: RawBodyRequest, res) => {
  if (!verifySlackRequest(req, res)) return;

  if (req.body?.type === "url_verification") {
    res.json({ challenge: req.body.challenge });
    return;
  }

  const event = req.body?.event;
  if (
    req.body?.type !== "event_callback" ||
    !event ||
    event.bot_id ||
    event.subtype === "bot_message"
  ) {
    res.json({ ok: true });
    return;
  }

  const brianUserId = process.env.SLACK_BRIAN_USER_ID;
  const text = typeof event.text === "string" ? event.text.trim() : "";
  const mockInterviewChannelId = process.env.SLACK_MOCK_INTERVIEW_CHANNEL_ID;
  const isBrianDm = event.user === brianUserId && event.channel_type === "im";
  const isMockInterviewChannel =
    event.user === brianUserId &&
    mockInterviewChannelId &&
    event.channel === mockInterviewChannelId;
  if ((!isBrianDm && !isMockInterviewChannel) || !text) {
    res.json({ ok: true });
    return;
  }

  res.json({ ok: true });

  try {
    if (/^(next question|question|interview|brain)$/i.test(text)) {
      await enqueueOrRun({ type: "send_next_interview_question" });
      return;
    }

    if (/^(next eval|eval|evaluation|rate answer|human eval)$/i.test(text)) {
      await enqueueOrRun({ type: "send_next_evaluation" });
      return;
    }

    await enqueueOrRun({ type: "record_interview_reply", text });
  } catch (error) {
    console.error(error);
  }
});

app.post("/slack/actions", async (req: RawBodyRequest, res) => {
  if (!verifySlackRequest(req, res)) return;

  let payload: {
    user?: { id?: string };
    actions?: Array<{ action_id?: string; value?: string }>;
  };
  try {
    payload = JSON.parse(req.body?.payload ?? "{}") as typeof payload;
  } catch {
    res.status(400).json({ text: "Invalid Slack payload." });
    return;
  }
  const brianUserId = process.env.SLACK_BRIAN_USER_ID;
  if (payload.user?.id !== brianUserId) {
    res.status(403).json({ text: "Only Brian can rate these answers." });
    return;
  }

  const action = payload.actions?.[0];
  const ratingByAction: Record<
    string,
    "good" | "bad" | "incomplete" | "too_high" | "too_low"
  > = {
    eval_good: "good",
    eval_bad: "bad",
    eval_incomplete: "incomplete",
    eval_too_high: "too_high",
    eval_too_low: "too_low",
  };
  const rating = action?.action_id
    ? ratingByAction[action.action_id]
    : undefined;
  if (action?.action_id === "interview_skip" && action.value) {
    res.json({ text: "Skipped." });
    try {
      await enqueueOrRun({
        type: "mark_interview_question_skipped",
        questionId: action.value,
        inappropriate: false,
      });
    } catch (error) {
      console.error(error);
    }
    return;
  }

  if (action?.action_id === "interview_inappropriate" && action.value) {
    res.json({ text: "Marked inappropriate." });
    try {
      await enqueueOrRun({
        type: "mark_interview_question_skipped",
        questionId: action.value,
        inappropriate: true,
      });
    } catch (error) {
      console.error(error);
    }
    return;
  }

  if (!action?.value || !rating) {
    res.status(400).json({ text: "Unknown action." });
    return;
  }

  res.json({ text: `Recorded: ${rating}.` });

  try {
    await enqueueOrRun({
      type: "rate_evaluation",
      evaluationId: action.value,
      rating,
    });
  } catch (error) {
    console.error(error);
  }
});

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  app.listen(port, () => {
    console.log(`Interview Brian locally: http://localhost:${port}`);
    void warmCareerAiModel();
    if (process.env.ASYNC_WORKER_ENABLED === "true") {
      void startAsyncWorker();
    }
  });
}

process.on("SIGTERM", () => stopAsyncWorker());
process.on("SIGINT", () => stopAsyncWorker());
