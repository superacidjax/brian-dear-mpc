import { startAsyncWorker, stopAsyncWorker } from "./asyncJobs.js";

process.on("SIGTERM", () => stopAsyncWorker());
process.on("SIGINT", () => stopAsyncWorker());

await startAsyncWorker();
