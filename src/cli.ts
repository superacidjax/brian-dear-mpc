#!/usr/bin/env node
import { askBrianCareerSmart, demoQuestions } from "./careerEngine.js";

const [, , command, ...rest] = process.argv;

async function printDemo() {
  for (const question of demoQuestions()) {
    console.log(`\n> ${question}`);
    console.log(await askBrianCareerSmart(question));
  }
}

if (command === "demo" || !command) {
  await printDemo();
} else if (command === "ask") {
  const question = rest.join(" ").trim();
  if (!question) {
    console.error('Usage: pnpm ask "Is Brian a fit for an AI platform role?"');
    process.exit(1);
  }
  console.log(await askBrianCareerSmart(question));
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Use: pnpm demo");
  console.error('Or:  pnpm ask "your question"');
  process.exit(1);
}
