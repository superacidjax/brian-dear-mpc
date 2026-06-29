import { describe, expect, it } from "vitest";
import { resolveJobDescriptionInput } from "../src/jobInput.js";

describe("job description input resolution", () => {
  it("treats ordinary pasted text as text", async () => {
    const input =
      "Staff Rails Engineer role with Ruby on Rails, PostgreSQL, AI evaluation workflows, and technical leadership.";

    await expect(resolveJobDescriptionInput(input)).resolves.toEqual({
      text: input,
    });
  });

  it("rejects non-https job links", async () => {
    await expect(
      resolveJobDescriptionInput("http://example.com/jobs/staff-engineer"),
    ).rejects.toThrow(/https/i);
  });

  it("rejects local job links", async () => {
    await expect(
      resolveJobDescriptionInput("https://localhost/jobs/staff-engineer"),
    ).rejects.toThrow(/local/i);
  });
});
