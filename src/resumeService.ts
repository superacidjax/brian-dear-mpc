import { spawn } from "node:child_process";
import path from "node:path";

const PDF_GENERATION_TIMEOUT_MS = Number(
  process.env.PDF_GENERATION_TIMEOUT_MS ?? 12_000,
);
const MAX_PDF_BYTES = 2_500_000;
const MAX_STDERR_BYTES = 20_000;

function pythonBin(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  return "python3";
}

function assertPdf(buffer: Buffer): void {
  if (
    buffer.byteLength < 500 ||
    buffer.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    throw new Error("Resume generator returned invalid PDF output.");
  }
}

export async function generateCustomizedResumePdf(
  jobDescription: string,
): Promise<Buffer> {
  const scriptPath = path.resolve(
    process.cwd(),
    "scripts/generate_custom_resume.py",
  );
  const careerDataPath = path.resolve(process.cwd(), "src/data/career.json");
  const input = JSON.stringify({ jobDescription, careerDataPath });

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(pythonBin(), [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("Resume generator timed out."));
    }, PDF_GENERATION_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_PDF_BYTES && !settled) {
        settled = true;
        child.kill("SIGKILL");
        clearTimeout(timeout);
        reject(new Error("Generated resume PDF is unexpectedly large."));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= MAX_STDERR_BYTES) stderr.push(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        const pdf = Buffer.concat(stdout);
        try {
          assertPdf(pdf);
          resolve(pdf);
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error("Resume generator returned invalid PDF output."),
          );
        }
        return;
      }

      reject(
        new Error(
          Buffer.concat(stderr).toString("utf8") ||
            `Resume generator exited with ${code}.`,
        ),
      );
    });

    child.stdin.end(input);
  });
}
