#!/usr/bin/env node

import {readdir, readFile, stat} from "node:fs/promises";
import path from "node:path";

const defaultApiBaseUrl = "https://gitee.com/api/v5";
const defaultOwner = "donnel";
const defaultRepo = "BOMBoard";

class ApiError extends Error {
  constructor(method, apiPath, response, body) {
    super(`${method} ${apiPath} failed with ${response.status}: ${body.slice(0, 500)}`);
    this.name = "ApiError";
    this.status = response.status;
  }
}

const options = parseArgs(process.argv.slice(2));
const token = process.env.GITEE_ACCESS_TOKEN || process.env.GITEE_TOKEN || "";
const tag = options.tag || process.env.RELEASE_REF_NAME || process.env.GITHUB_REF_NAME || "";
const assetsDir = options.assets || "release-assets";
const owner = process.env.GITEE_OWNER || defaultOwner;
const repo = process.env.GITEE_REPO || defaultRepo;
const apiBaseUrl = process.env.GITEE_API_BASE_URL || defaultApiBaseUrl;
const targetCommitish = process.env.GITEE_TARGET_COMMITISH || process.env.GITHUB_SHA || "main";
const retryCount = positiveInteger(process.env.GITEE_RELEASE_RETRIES, 12);
const retryDelayMs = positiveInteger(process.env.GITEE_RELEASE_RETRY_DELAY_MS, 10_000);

if (!token) {
  console.log("GITEE_ACCESS_TOKEN is not set. Skipping Gitee release publishing.");
  process.exit(0);
}

if (!tag) {
  throw new Error("Release tag is required. Pass --tag or set RELEASE_REF_NAME.");
}

const assetPaths = await collectFiles(path.resolve(assetsDir));

if (assetPaths.length === 0) {
  throw new Error(`No release assets found in ${assetsDir}.`);
}

const release = await retry(
  () => ensureRelease(),
  retryCount,
  retryDelayMs,
  error => error instanceof ApiError && [404, 409, 422, 500, 502, 503, 504].includes(error.status)
);

const releaseId = numericId(release.id, "release");
await syncAttachments(releaseId, assetPaths);

console.log(`Gitee release ${tag} is ready with ${assetPaths.length} asset(s).`);

async function ensureRelease() {
  const existing = await getReleaseByTag(tag);
  const body = releaseBody(tag, assetPaths);
  const prerelease = tag.includes("-");

  if (existing) {
    const existingReleaseId = numericId(existing.id, "release");

    return requestJson("PATCH", `/repos/${owner}/${repo}/releases/${existingReleaseId}`, {
      body: {
        body,
        name: tag,
        prerelease,
        tagName: tag,
      },
    });
  }

  return requestJson("POST", `/repos/${owner}/${repo}/releases`, {
    body: {
      body,
      name: tag,
      prerelease,
      tagName: tag,
      targetCommitish,
    },
  });
}

async function getReleaseByTag(releaseTag) {
  const response = await apiFetch(
    "GET",
    `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(releaseTag)}`
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ApiError("GET", `/repos/${owner}/${repo}/releases/tags/${releaseTag}`, response, await response.text());
  }

  return response.json();
}

async function syncAttachments(releaseId, files) {
  const existingFiles = new Map();
  for (const attachment of await listAttachments(releaseId)) {
    if (typeof attachment.name === "string") {
      existingFiles.set(attachment.name, attachment);
    }
  }

  for (const filePath of files) {
    const name = path.basename(filePath);
    const size = (await stat(filePath)).size;
    const existing = existingFiles.get(name);

    if (existing && Number(existing.size) === size) {
      console.log(`Skipping unchanged Gitee asset: ${name}`);
      continue;
    }

    const existingId = existing ? numericId(existing.id, "attachment") : null;

    if (existingId !== null) {
      await requestJson(
        "DELETE",
        `/repos/${owner}/${repo}/releases/${releaseId}/attach_files/${existingId}`
      );
    }

    await uploadAttachment(releaseId, filePath);
  }
}

async function listAttachments(releaseId) {
  const attachments = [];
  let page = 1;

  while (true) {
    const batch = await requestJson(
      "GET",
      `/repos/${owner}/${repo}/releases/${releaseId}/attach_files`,
      {query: {page, per_page: 100}}
    );

    if (!Array.isArray(batch) || batch.length === 0) break;
    attachments.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return attachments;
}

async function uploadAttachment(releaseId, filePath) {
  const name = path.basename(filePath);
  const data = await readFile(filePath);
  const form = new FormData();

  form.append("file", new Blob([data]), name);
  await requestJson("POST", `/repos/${owner}/${repo}/releases/${releaseId}/attach_files`, {
    body: form,
  });
  console.log(`Uploaded Gitee asset: ${name}`);
}

async function requestJson(method, apiPath, options = {}) {
  const response = await apiFetch(method, apiPath, options);
  const text = await response.text();

  if (!response.ok) {
    throw new ApiError(method, apiPath, response, text);
  }

  return text ? JSON.parse(text) : null;
}

async function apiFetch(method, apiPath, options = {}) {
  const url = new URL(`${apiBaseUrl.replace(/\/$/, "")}${apiPath}`);
  url.searchParams.set("access_token", token);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, String(value));
  }

  const headers = {};
  let body = options.body;

  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  return fetch(url, {
    method,
    headers,
    body,
  });
}

async function collectFiles(root) {
  const rootStat = await stat(root);

  if (rootStat.isFile()) return [root];
  if (!rootStat.isDirectory()) return [];

  const entries = await readdir(root, {withFileTypes: true});
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  files.sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
  return files;
}

async function retry(task, attempts, delayMs, shouldRetry) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) break;

      console.log(`Gitee release is not ready yet. Retry ${attempt}/${attempts - 1} in ${delayMs}ms.`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function releaseBody(releaseTag, files) {
  const lines = [
    `BOMBoard ${releaseTag}`,
    "",
    "This release was generated automatically from the GitHub release workflow.",
    "",
    "Assets:",
    ...files.map(file => `- ${path.basename(file)}`),
  ];

  return lines.join("\n");
}

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--tag") {
      parsed.tag = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--assets") {
      parsed.assets = args[index + 1] ?? "";
      index += 1;
    }
  }

  return parsed;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numericId(value, label) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Gitee ${label} id is missing from the API response.`);
  }

  return parsed;
}
