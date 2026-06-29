#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildCoverLetterAngle,
  getCompensationTarget,
  getInterviewStory,
  getProjectExamples,
  getPublicLinks,
  getResumeSummary,
  matchJobDescriptionWithLearning,
  askBrianCareerSmart,
} from "./careerEngine.js";

const roleTypeSchema = z.enum([
  "rails",
  "ai_platform",
  "product_engineering",
  "vp_platform",
  "healthcare",
  "startup",
  "general",
]);
const projectThemeSchema = z.enum([
  "healthcare",
  "ai",
  "rails",
  "platform",
  "leadership",
  "regulated_systems",
  "startup",
  "developer_productivity",
  "product_engineering",
]);
const questionTypeSchema = z.enum([
  "ownership",
  "ambiguity",
  "leadership",
  "failure",
  "ai",
  "healthcare",
  "platform",
  "conflict",
  "technical_depth",
]);
const roleLevelSchema = z.enum([
  "senior_engineer",
  "staff_engineer",
  "engineering_manager",
  "director",
  "vp",
  "contract",
]);
const marketSchema = z.enum(["us_remote", "europe_remote", "contract_us"]);

function textResponse(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function jsonResponse(value: unknown) {
  return textResponse(JSON.stringify(value, null, 2));
}

const server = new McpServer({
  name: "brian-dear-career-mcp",
  version: "0.1.0",
});

server.registerTool(
  "get_resume_summary",
  {
    title: "Get Resume Summary",
    description:
      "Return a concise Brian Dear profile summary tailored to a requested role type.",
    inputSchema: {
      role_type: roleTypeSchema,
    },
  },
  async ({ role_type }) => textResponse(getResumeSummary(role_type)),
);

server.registerTool(
  "match_job_description",
  {
    title: "Match Job Description",
    description:
      "Analyze Brian Dear's fit for a job description and return recruiter-friendly fit guidance.",
    inputSchema: {
      job_description: z.string().min(20),
    },
  },
  async ({ job_description }) =>
    jsonResponse(await matchJobDescriptionWithLearning(job_description)),
);

server.registerTool(
  "get_project_examples",
  {
    title: "Get Project Examples",
    description: "Return relevant Brian Dear career stories based on a theme.",
    inputSchema: {
      theme: projectThemeSchema,
    },
  },
  async ({ theme }) => jsonResponse(getProjectExamples(theme)),
);

server.registerTool(
  "get_interview_story",
  {
    title: "Get Interview Story",
    description:
      "Return a concise interview answer in Brian Dear's grounded third-person voice.",
    inputSchema: {
      question_type: questionTypeSchema,
    },
  },
  async ({ question_type }) => textResponse(getInterviewStory(question_type)),
);

server.registerTool(
  "get_cover_letter_angle",
  {
    title: "Get Cover Letter Angle",
    description:
      "Given a company and job description, suggest three strong cover letter angles.",
    inputSchema: {
      company: z.string().min(1),
      job_description: z.string().min(20),
    },
  },
  async ({ company, job_description }) =>
    jsonResponse(buildCoverLetterAngle(company, job_description)),
);

server.registerTool(
  "get_compensation_target",
  {
    title: "Get Compensation Target",
    description:
      "Return Brian Dear's compensation positioning. Public ranges are intentionally not included.",
    inputSchema: {
      role_level: roleLevelSchema,
      market: marketSchema,
    },
  },
  async ({ role_level, market }) =>
    textResponse(getCompensationTarget(role_level, market)),
);

server.registerTool(
  "get_public_links",
  {
    title: "Get Public Links",
    description:
      "Return Brian Dear's public profile links and contact handoff guidance.",
    inputSchema: {},
  },
  async () => jsonResponse(getPublicLinks()),
);

server.registerTool(
  "ask_brian_career",
  {
    title: "Ask Brian Career",
    description:
      "General grounded Q&A over Brian Dear's structured career data.",
    inputSchema: {
      question: z.string().min(3),
    },
  },
  async ({ question }) => textResponse(await askBrianCareerSmart(question)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
