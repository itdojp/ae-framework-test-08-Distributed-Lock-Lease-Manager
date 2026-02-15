#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REQUIREMENTS_PATH = "spec/requirements.md";
const OUT_DIR = "artifacts/traceability";

const root = process.cwd();
const requirementsPath = path.join(root, REQUIREMENTS_PATH);

if (!fs.existsSync(requirementsPath)) {
  console.error(`requirements file not found: ${REQUIREMENTS_PATH}`);
  process.exit(1);
}

const trackedFiles = collectFiles(root);
const content = fs.readFileSync(requirementsPath, "utf-8");
const lines = content.split(/\r?\n/);
const rows = parseTraceabilityRows(lines);

if (rows.length === 0) {
  console.error("traceability rows not found in spec/requirements.md");
  process.exit(1);
}

const evaluated = rows.map((row) => evaluateRow(row, trackedFiles));
const totalRows = evaluated.length;
const fullMappedRows = evaluated.filter((row) => row.allPresent).length;
const failedRows = evaluated.filter((row) => !row.allPresent);
const coveragePercent = Math.round((fullMappedRows / totalRows) * 10000) / 100;

const report = {
  source: REQUIREMENTS_PATH,
  generatedAt: new Date().toISOString(),
  summary: {
    totalRows,
    fullMappedRows,
    failedRows: failedRows.length,
    coveragePercent
  },
  rows: evaluated
};

fs.mkdirSync(path.join(root, OUT_DIR), { recursive: true });
const jsonPath = path.join(root, OUT_DIR, "latest.json");
const mdPath = path.join(root, OUT_DIR, "latest.md");
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
fs.writeFileSync(mdPath, renderMarkdown(report), "utf-8");

console.log(`traceability rows: ${totalRows}`);
console.log(`full mapped rows: ${fullMappedRows}`);
console.log(`coverage: ${coveragePercent}%`);
console.log(`json: ${OUT_DIR}/latest.json`);
console.log(`markdown: ${OUT_DIR}/latest.md`);

/**
 * @param {string} rootDir
 * @returns {Set<string>}
 */
function collectFiles(rootDir) {
  const files = new Set();
  const stack = [rootDir];
  const ignoredDirs = new Set([".git", ".cache"]);

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(rootDir, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) {
          continue;
        }
        stack.push(absolute);
      } else if (entry.isFile()) {
        files.add(relative);
      }
    }
  }
  return files;
}

/**
 * @param {string[]} lines
 * @returns {Array<{ requirementId: string, implPaths: string[], testPaths: string[] }>}
 */
function parseTraceabilityRows(lines) {
  const rows = [];
  let inSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "## 4. トレーサビリティ") {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) {
      break;
    }
    if (!inSection || !line.startsWith("|")) {
      continue;
    }
    if (line.includes("---")) {
      continue;
    }
    const cells = rawLine
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3) {
      continue;
    }
    if (cells[0] === "要求ID") {
      continue;
    }

    rows.push({
      requirementId: cells[0],
      implPaths: extractPaths(cells[1]),
      testPaths: extractPaths(cells[2])
    });
  }
  return rows;
}

/**
 * @param {string} cell
 * @returns {string[]}
 */
function extractPaths(cell) {
  const values = [];
  const re = /`([^`]+)`/g;
  let match = re.exec(cell);
  while (match) {
    values.push(match[1].trim());
    match = re.exec(cell);
  }
  return values;
}

/**
 * @param {{ requirementId: string, implPaths: string[], testPaths: string[] }} row
 * @param {Set<string>} files
 */
function evaluateRow(row, files) {
  const impl = row.implPaths.map((p) => evaluatePath(p, files));
  const tests = row.testPaths.map((p) => evaluatePath(p, files));
  const hasRefs = impl.length > 0 && tests.length > 0;
  const allPresent = hasRefs && [...impl, ...tests].every((p) => p.exists);
  return {
    requirementId: row.requirementId,
    implementation: impl,
    tests,
    allPresent
  };
}

/**
 * @param {string} pattern
 * @param {Set<string>} files
 */
function evaluatePath(pattern, files) {
  if (!hasGlob(pattern)) {
    return {
      path: pattern,
      exists: files.has(pattern)
    };
  }
  const matcher = globToRegExp(pattern);
  const matches = [];
  for (const file of files) {
    if (matcher.test(file)) {
      matches.push(file);
    }
  }
  return {
    path: pattern,
    exists: matches.length > 0,
    matches
  };
}

/**
 * @param {string} value
 */
function hasGlob(value) {
  return /[*?]/.test(value);
}

/**
 * @param {string} glob
 */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = escaped.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${regex}$`);
}

/**
 * @param {{
 * source: string,
 * generatedAt: string,
 * summary: { totalRows: number, fullMappedRows: number, failedRows: number, coveragePercent: number },
 * rows: Array<{ requirementId: string, implementation: Array<{path: string, exists: boolean}>, tests: Array<{path: string, exists: boolean}>, allPresent: boolean }>
 * }} report
 */
function renderMarkdown(report) {
  const lines = [];
  lines.push("# Traceability Report");
  lines.push("");
  lines.push(`- source: \`${report.source}\``);
  lines.push(`- generated_at: \`${report.generatedAt}\``);
  lines.push(`- rows: \`${report.summary.totalRows}\``);
  lines.push(`- full_mapped: \`${report.summary.fullMappedRows}\``);
  lines.push(`- failed_rows: \`${report.summary.failedRows}\``);
  lines.push(`- coverage: \`${report.summary.coveragePercent}%\``);
  lines.push("");
  lines.push("## Failed Rows");
  lines.push("");
  lines.push("| requirement_id | missing_paths |");
  lines.push("| --- | --- |");

  const failed = report.rows.filter((row) => !row.allPresent);
  if (failed.length === 0) {
    lines.push("| (none) | - |");
  } else {
    for (const row of failed) {
      const missing = [...row.implementation, ...row.tests]
        .filter((ref) => !ref.exists)
        .map((ref) => `\`${ref.path}\``)
        .join(", ");
      lines.push(`| ${row.requirementId} | ${missing} |`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
