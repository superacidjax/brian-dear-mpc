import { lookup } from "node:dns/promises";
import { request } from "node:https";
import net from "node:net";
import { parse } from "node-html-parser";

const MAX_JOB_PAGE_BYTES = 750_000;
const JOB_FETCH_TIMEOUT_MS = 9000;
const MAX_REDIRECTS = 4;

interface FetchedPage {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function firstUrl(value: string): URL | undefined {
  const match = value.match(/https?:\/\/[^\s<>"')]+/i);
  if (!match) return undefined;

  try {
    return new URL(match[0]);
  } catch {
    return undefined;
  }
}

function shouldFetchUrl(input: string, url: URL): boolean {
  const withoutUrl = input.replace(url.toString(), "").trim();
  return input.trim() === url.toString() || withoutUrl.length < 120;
}

function isPrivateIp(address: string): boolean {
  if (net.isIP(address) === 0) return false;

  const lowered = address.toLowerCase();
  if (
    address === "::" ||
    address === "::1" ||
    lowered.startsWith("fc") ||
    lowered.startsWith("fd") ||
    lowered.startsWith("fe80")
  ) {
    return true;
  }

  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part)))
    return false;

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

async function publicAddressFor(
  url: URL,
): Promise<{ address: string; family: number }> {
  if (url.protocol !== "https:") {
    throw new Error("Only public https job links are supported.");
  }

  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error("Local job links are not supported.");
  }

  const addresses = await lookup(url.hostname, { all: true });
  if (
    addresses.length === 0 ||
    addresses.some((address) => isPrivateIp(address.address))
  ) {
    throw new Error("Private-network job links are not supported.");
  }

  return addresses[0];
}

async function fetchPublicHttps(url: URL): Promise<FetchedPage> {
  const target = await publicAddressFor(url);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const req = request(
      url,
      {
        method: "GET",
        lookup: (_hostname, _options, callback) =>
          callback(null, target.address, target.family),
        timeout: JOB_FETCH_TIMEOUT_MS,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
          "User-Agent": "BrianDearCareerAgent/1.0 (+https://www.briandear.ai)",
        },
      },
      (response) => {
        response.on("data", (chunk: Buffer) => {
          totalBytes += chunk.byteLength;
          if (totalBytes > MAX_JOB_PAGE_BYTES) {
            req.destroy(
              new Error(
                "That job page is too large to parse. Paste the job description text instead.",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(
        new Error(
          "That job link took too long to answer. Paste the job description text instead.",
        ),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function extractReadableText(raw: string, contentType: string): string {
  if (!/html|xml/i.test(contentType)) {
    return cleanText(raw);
  }

  const root = parse(raw);
  root
    .querySelectorAll(
      "script, style, noscript, svg, nav, header, footer, form, iframe",
    )
    .forEach((node) => node.remove());

  const candidates = [
    ...root.querySelectorAll("main"),
    ...root.querySelectorAll("article"),
    ...root.querySelectorAll("[role=main]"),
    root.querySelector("body"),
    root,
  ].filter(Boolean);

  const text = candidates
    .map((node) => cleanText(node!.textContent))
    .sort((a, b) => b.length - a.length)[0];

  return text ?? "";
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function resolveJobDescriptionInput(
  input: string,
): Promise<{ text: string; sourceUrl?: string }> {
  const trimmed = input.trim();
  const initialUrl = firstUrl(trimmed);
  if (!initialUrl || !shouldFetchUrl(trimmed, initialUrl)) {
    return { text: trimmed };
  }

  let url = initialUrl;
  let response: FetchedPage | undefined;

  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    response = await fetchPublicHttps(url);

    if (!isRedirect(response.status)) {
      break;
    }

    const location = headerValue(response.headers.location);
    if (!location) {
      throw new Error(
        "That job link redirects without a destination. Paste the job description text instead.",
      );
    }

    url = new URL(location, url);
    if (redirectCount === MAX_REDIRECTS) {
      throw new Error(
        "That job link redirects too many times. Paste the job description text instead.",
      );
    }
  }

  if (!response) {
    throw new Error("Could not fetch that job link.");
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `The job link returned HTTP ${response.status}. Paste the job description text instead.`,
    );
  }

  const contentType =
    headerValue(response.headers["content-type"]) ?? "text/plain";
  const readableText = extractReadableText(response.body, contentType);
  if (readableText.length < 160) {
    throw new Error(
      "That job link did not expose enough readable text. Paste the job description text instead.",
    );
  }

  const extraNotes = trimmed.replace(initialUrl.toString(), "").trim();
  return {
    text: extraNotes
      ? `${readableText}\n\nAdditional notes from recruiter:\n${extraNotes}`
      : readableText,
    sourceUrl: initialUrl.toString(),
  };
}
