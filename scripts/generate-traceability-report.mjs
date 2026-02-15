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

const fileCache = new Map();
const content = fs.readFileSync(requirementsPath, "utf-8");
const lines = content.split(/\r?\n/);
const rows = parseTraceabilityRows(lines);

if (rows.length === 0) {
  console.error("traceability rows not found in spec/requirements.md");
  process.exit(1);
}

const evaluated = rows.map((row) => evaluateRow(row, root, fileCache));
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
 * @param {string} rootDir
 * @param {Map<string, Set<string>>} fileCache
 */
function evaluateRow(row, rootDir, fileCache) {
  const impl = row.implPaths.map((p) => evaluatePath(p, rootDir, fileCache));
  const tests = row.testPaths.map((p) => evaluatePath(p, rootDir, fileCache));
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
 * @param {string} rootDir
 * @param {Map<string, Set<string>>} fileCache
 */
function evaluatePath(pattern, rootDir, fileCache) {
  const normalized = pattern.split("\\").join("/");
  if (!hasGlob(pattern)) {
    return {
      path: pattern,
      exists: fs.existsSync(path.join(rootDir, pattern))
    };
  }

  const searchRootRel = findSearchRoot(normalized);
  const files = listFilesUnder(rootDir, searchRootRel, fileCache);
  const matcher = globToRegExp(normalized);
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
 * @param {string} pattern
 * @returns {string}
 */
function findSearchRoot(pattern) {
  const wildcardPos = pattern.search(/[*?]/);
  if (wildcardPos < 0) {
    return path.posix.dirname(pattern);
  }
  const slashPos = pattern.lastIndexOf("/", wildcardPos);
  if (slashPos < 0) {
    return ".";
  }
  return pattern.slice(0, slashPos);
}

/**
 * @param {string} rootDir
 * @param {string} searchRootRel
 * @param {Map<string, Set<string>>} fileCache
 * @returns {Set<string>}
 */
function listFilesUnder(rootDir, searchRootRel, fileCache) {
  const key = searchRootRel || ".";
  const cached = fileCache.get(key);
  if (cached) {
    return cached;
  }

  const absoluteRoot = path.join(rootDir, key);
  const files = new Set();
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    fileCache.set(key, files);
    return files;
  }

  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        const relative = path.relative(rootDir, absolute).split(path.sep).join("/");
        files.add(relative);
      }
    }
  }
  fileCache.set(key, files);
  return files;
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
