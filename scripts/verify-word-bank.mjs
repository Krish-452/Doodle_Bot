#!/usr/bin/env node
/**
 * Verifies lib/word-bank.ts against public/model/class_names.txt (issue #6):
 *   - every `labels` entry is a real class the model emits
 *   - no duplicate `id`s
 *   - entry count is called out if outside the 40-60 recommendation (not a hard failure —
 *     the real constraint is model accuracy, see lib/word-bank.ts's module comment)
 *
 * Run: node scripts/verify-word-bank.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const classNames = new Set(
  readFileSync(join(root, "public/model/class_names.txt"), "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
);

const source = readFileSync(join(root, "lib/word-bank.ts"), "utf-8");

// Strip comments so commented-out example entries don't get parsed as real ones.
const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const entryRe = /\{\s*id:\s*"([^"]+)"\s*,\s*labels:\s*\[([^\]]*)\]\s*,\s*difficulty:\s*"(easy|medium|hard)"\s*\}/g;

const entries = [];
let match;
while ((match = entryRe.exec(stripped)) !== null) {
  const [, id, labelsRaw] = match;
  const labels = [...labelsRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  entries.push({ id, labels });
}

let failed = false;

if (entries.length === 0) {
  console.error("FAIL — no entries parsed from lib/word-bank.ts (regex out of sync with the file's shape?)");
  process.exit(1);
}

const seenIds = new Set();
for (const { id } of entries) {
  if (seenIds.has(id)) {
    console.error(`FAIL — duplicate id: "${id}"`);
    failed = true;
  }
  seenIds.add(id);
}

for (const { id, labels } of entries) {
  for (const label of labels) {
    if (!classNames.has(label)) {
      console.error(`FAIL — "${id}" has label "${label}", which is not in class_names.txt`);
      failed = true;
    }
  }
}

if (entries.length < 40 || entries.length > 60) {
  console.log(
    `Note: ${entries.length} entries — outside the 40-60 target range (not a hard failure, see PRD § open questions).`,
  );
}

if (failed) {
  process.exit(1);
}

console.log(`OK — ${entries.length} entries, all labels are real model classes, no duplicate ids.`);
