import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleCareerChatMessage } from "../src/chatService.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "brian-chat-test-"));
  delete process.env.BRAIN_STORE;
  process.env.BRAIN_FILE_PATH = path.join(tmpDir, "brain-store.json");
  process.env.CAREER_AI_PROVIDER = "off";
});

afterEach(async () => {
  delete process.env.BRAIN_FILE_PATH;
  await rm(tmpDir, { force: true, recursive: true });
});

describe("career chat job detection", () => {
  it("scores concise role blurbs as job descriptions", async () => {
    const response = await handleCareerChatMessage({
      message:
        "AI Product Engineering Lead owning agentic AI workflows, human evaluation systems, Rails APIs, React interfaces, product judgment, and executive stakeholder communication.",
    });

    expect(response.kind).toBe("job_match");
    expect(response.fit?.score).toBeGreaterThanOrEqual(90);
    expect(response.fit?.label).toBe("Great Fit");
    expect(response.text).not.toMatch(/\bscore\b|\b\d{1,3}\b/i);
  });

  it("scores concise director role blurbs as job descriptions", async () => {
    const response = await handleCareerChatMessage({
      message:
        "Director of Engineering for internal developer platforms, AWS cloud tooling, CI/CD, Rails services, data-heavy workflows, executive roadmaps, and mentoring engineering teams.",
    });

    expect(response.kind).toBe("job_match");
    expect(response.fit?.score).toBeGreaterThanOrEqual(90);
    expect(response.fit?.label).toBe("Great Fit");
  });

  it("keeps concise unrelated role blurbs low", async () => {
    const response = await handleCareerChatMessage({
      message:
        "Districtwide Teacher Application. Develop lesson plans, manage classroom behavior, teach students according to district curriculum, maintain student records, and attend campus activities.",
    });

    expect(response.kind).toBe("job_match");
    expect(response.fit?.score).toBeLessThanOrEqual(43);
    expect(response.fit?.label).toBe("Low Fit");
  });
});
