import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/web.js";

let tmpDir: string;
const previousEnv = { ...process.env };

function resetEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in previousEnv)) delete process.env[key];
  }
  Object.assign(process.env, previousEnv);
}

function slackSignature(
  body: string,
  secret: string,
): { timestamp: string; signature: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const base = `v0:${timestamp}:${body}`;
  return {
    timestamp,
    signature: `v0=${crypto.createHmac("sha256", secret).update(base).digest("hex")}`,
  };
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "brian-security-test-"));
  resetEnv();
  process.env.BRAIN_FILE_PATH = path.join(tmpDir, "brain-store.json");
  process.env.CAREER_AI_PROVIDER = "off";
});

afterEach(async () => {
  resetEnv();
  await rm(tmpDir, { force: true, recursive: true });
});

describe("security-sensitive web routes", () => {
  it("requires the admin token in a header and rejects query-string tokens", async () => {
    process.env.ADMIN_TOKEN = "admin-token-with-enough-length";

    await request(app).get("/api/brain/status").expect(401);
    await request(app)
      .get("/api/brain/status?token=admin-token-with-enough-length")
      .expect(401);

    const response = await request(app)
      .get("/api/brain/status")
      .set("x-admin-token", "admin-token-with-enough-length")
      .expect(200);
    expect(response.body).toHaveProperty("brain_facts", 0);
  });

  it("blocks direct production origin traffic when the CloudFront shared header is configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.ORIGIN_SHARED_SECRET = "shared-origin-secret-value";

    await request(app).get("/healthz").expect(200);
    await request(app).get("/api/samples").expect(403);
    await request(app)
      .get("/api/samples")
      .set("x-origin-verify", "shared-origin-secret-value")
      .expect(200);
  });

  it("returns 400 for malformed Slack interactive payloads after signature verification", async () => {
    process.env.SLACK_SIGNING_SECRET = "slack-signing-secret";
    const body = "payload=%7Bnot-json";
    const { timestamp, signature } = slackSignature(
      body,
      process.env.SLACK_SIGNING_SECRET,
    );

    const response = await request(app)
      .post("/slack/actions")
      .set("content-type", "application/x-www-form-urlencoded")
      .set("x-slack-request-timestamp", timestamp)
      .set("x-slack-signature", signature)
      .send(body)
      .expect(400);

    expect(response.body.text).toBe("Invalid Slack payload.");
  });

  it("does not accept non-PDF resume generator output", async () => {
    process.env.PYTHON_BIN = "false";

    await request(app)
      .post("/api/resume")
      .send({
        jobDescription:
          "Staff Rails Engineer role requiring Ruby on Rails, PostgreSQL, AI platform work, product judgment, mentoring, and executive communication.",
      })
      .expect(500);
  });
});
