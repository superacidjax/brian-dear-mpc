import { matchJobDescription } from "./careerEngine.js";

const cases = [
  {
    name: "preschool lead teacher",
    text: "Lead Teacher role creating lesson plans, managing a preschool classroom, supporting children, following licensing guidelines, and communicating with families.",
    max: 43,
  },
  {
    name: "district classroom teacher",
    text: "Districtwide Teacher Application. Develop lesson plans, manage classroom behavior, teach students according to district curriculum, maintain student records, and attend campus activities.",
    max: 43,
  },
  {
    name: "retail floor lead",
    text: "Floor Lead for a beauty retail store. Responsibilities include customer service, sales goals, opening and closing, inventory management, coaching sales associates, and product recommendations.",
    max: 43,
  },
  {
    name: "staff rails ai platform",
    text: "Staff Rails Engineer for an AI evaluation platform. Requires Ruby on Rails, PostgreSQL, TypeScript, AWS, RAG workflows, model evaluation, product judgment, platform engineering, and mentoring engineers.",
    min: 90,
  },
];

for (const item of cases) {
  const score = matchJobDescription(item.text).fit_score;
  if (typeof item.max === "number" && score > item.max) {
    throw new Error(`${item.name} scored ${score}; expected <= ${item.max}.`);
  }
  if (typeof item.min === "number" && score < item.min) {
    throw new Error(`${item.name} scored ${score}; expected >= ${item.min}.`);
  }
  console.log(`${item.name}: ${score}`);
}
