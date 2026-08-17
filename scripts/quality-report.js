#!/usr/bin/env node
/**
 * Quality report — test success rate and coverage, evaluated against the gate
 * of every environment in one place.
 *
 *   npm run report          full suite (unit + integration + E2E), then report
 *   npm run report:fast     unit tests only, no database, for a quick read
 *   npm run report:last     re-print the previous run without executing anything
 *
 * Coverage does not depend on the environment — the *threshold* does. So a
 * single run answers both questions: 60% for Test, 85% for Production.
 *
 * Jest's own `coverageThreshold` is neutralised while collecting (COVERAGE_MIN=0)
 * so that a miss produces a full report explaining what fell short instead of a
 * bare non-zero exit. The gates are then applied here, and the exit code still
 * reflects them, so this is equally usable in a pipeline. The real enforcement
 * in CI remains Jest's own threshold; this never relaxes it.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COVERAGE_SUMMARY = path.join(ROOT, 'coverage', 'coverage-summary.json');
const RESULTS_FILE = path.join(ROOT, 'coverage', 'test-results.json');

/** The quality bar each environment's pipeline enforces. */
const ENVIRONMENTS = [
  { name: 'Test', min: 60, branch: 'develop', workflow: 'test-pipeline.yml' },
  { name: 'Production', min: 85, branch: 'main', workflow: 'production-pipeline.yml' },
];

const METRICS = ['lines', 'statements', 'functions', 'branches'];

// --- tiny terminal helpers --------------------------------------------------
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColour ? `[${code}m${text}[0m` : text);
const bold = (t) => paint('1', t);
const dim = (t) => paint('2', t);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const yellow = (t) => paint('33', t);

const verdict = (ok) => (ok ? green('PASS') : red('FAIL'));
const pct = (n) => `${n.toFixed(2)}%`;

let jestOutput = '';

const args = new Set(process.argv.slice(2));
const fastMode = args.has('--fast');
const reuseLast = args.has('--last');

// --- run the suite ----------------------------------------------------------
function runSuite() {
  const jestArgs = ['jest', '--coverage', '--runInBand', '--json', `--outputFile=${RESULTS_FILE}`];
  if (fastMode) jestArgs.push('--selectProjects', 'unit');

  process.stdout.write(dim(`Running ${fastMode ? 'unit tests' : 'unit + integration + E2E'}…\n\n`));

  const result = spawnSync('npx', jestArgs, {
    cwd: ROOT,
    // Jest writes its own summary to stderr; captured so it does not duplicate
    // the report below, and replayed only when something actually broke.
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      // Report everything; the gates below decide pass or fail.
      COVERAGE_MIN: '0',
      // Unit tests need no database, so skip booting one.
      ...(fastMode ? { SKIP_DB: 'true' } : {}),
    },
  });

  if (result.error) {
    console.error(red(`Could not run Jest: ${result.error.message}`));
    process.exit(2);
  }

  // A non-zero exit means failing tests, which the report explains. Anything
  // that also prevented the results file from being written is fatal, and the
  // captured output is the only clue to why.
  if (result.status !== 0 && !fs.existsSync(RESULTS_FILE)) {
    console.error(result.stderr || '');
    console.error(red('Jest exited without writing a results file.'));
    process.exit(2);
  }

  jestOutput = result.stderr || '';
}

function readJson(file, label) {
  if (!fs.existsSync(file)) {
    console.error(red(`No ${label} found at ${path.relative(ROOT, file)}.`));
    console.error(dim('Run `npm run report` first to generate one.'));
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// --- rendering --------------------------------------------------------------
function renderTests(results) {
  const { numTotalTests, numPassedTests, numFailedTests, numPendingTests } = results;
  const { numTotalTestSuites, numPassedTestSuites } = results;
  const rate = numTotalTests > 0 ? (numPassedTests / numTotalTests) * 100 : 0;
  const allGreen = numFailedTests === 0 && numTotalTests > 0;

  const seconds = results.startTime ? ((Date.now() - results.startTime) / 1000).toFixed(1) : null;

  console.log(bold('TESTS'));
  console.log(`  Suites        ${numPassedTestSuites} / ${numTotalTestSuites} passed`);
  console.log(
    `  Tests         ${numPassedTests} / ${numTotalTests} passed` +
      `   ${allGreen ? green(pct(rate)) : red(pct(rate))}`,
  );
  if (numFailedTests > 0) console.log(`  ${red(`Failed        ${numFailedTests}`)}`);
  if (numPendingTests > 0) console.log(`  ${yellow(`Skipped       ${numPendingTests}`)}`);
  console.log(`  Zero failures ${verdict(allGreen)}`);
  if (seconds && !reuseLast) console.log(dim(`  Ran in ${seconds}s`));
  console.log();

  return allGreen;
}

function renderFailures(results) {
  const failed = (results.testResults || []).filter((suite) => suite.status === 'failed');
  if (failed.length === 0) return;

  if (jestOutput.trim()) {
    console.log(dim('--- Jest output ---'));
    console.log(jestOutput.trimEnd());
    console.log(dim('-------------------'));
    console.log();
  }

  console.log(bold(red('FAILING TESTS')));
  for (const suite of failed) {
    console.log(`  ${path.relative(ROOT, suite.name)}`);
    for (const test of suite.assertionResults || []) {
      if (test.status !== 'failed') continue;
      console.log(`    ${red('x')} ${test.fullName}`);
    }
  }
  console.log();
}

function renderCoverage(total) {
  const header =
    '  Metric'.padEnd(16) +
    'Covered'.padStart(9) +
    '  ' +
    ENVIRONMENTS.map((e) => `${e.name} (${e.min}%)`.padStart(18)).join('');
  console.log(bold('COVERAGE'));
  console.log(dim(header));

  for (const metric of METRICS) {
    const value = total[metric].pct;
    const counts = dim(`(${total[metric].covered}/${total[metric].total})`);
    const cells = ENVIRONMENTS.map((env) => {
      const ok = value >= env.min;
      const word = ok ? 'PASS' : 'FAIL';
      // Pad first, colour second: ANSI codes have no width on screen but would
      // otherwise be counted by padStart and knock the columns out of line.
      return ' '.repeat(18 - word.length) + verdict(ok);
    }).join('');

    console.log('  ' + metric.padEnd(14) + pct(value).padStart(9) + '  ' + cells + '  ' + counts);
  }
  console.log();
}

function renderGates(total, testsGreen) {
  console.log(bold('QUALITY GATES'));

  const outcomes = ENVIRONMENTS.map((env) => {
    const shortfalls = METRICS.filter((m) => total[m].pct < env.min);
    const ok = testsGreen && shortfalls.length === 0;
    const label = `${env.name} (>= ${env.min}%)`.padEnd(26);
    console.log(`  ${label}${verdict(ok)}   ${dim(`${env.branch} · ${env.workflow}`)}`);
    if (!testsGreen) {
      console.log(`    ${red('blocked by failing tests')}`);
    }
    for (const metric of shortfalls) {
      console.log(
        `    ${red(`${metric} at ${pct(total[metric].pct)}, needs ${env.min}%`)}` +
          dim(` (${(env.min - total[metric].pct).toFixed(2)} points short)`),
      );
    }
    return { env, ok };
  });

  console.log();
  return outcomes;
}

function renderWeakestFiles(summary) {
  const files = Object.entries(summary)
    .filter(([key]) => key !== 'total')
    .map(([file, data]) => ({
      file: path.relative(ROOT, file).replace(/\\/g, '/'),
      lines: data.lines.pct,
      branches: data.branches.pct,
      // Counts matter here: a single defaulted parameter reads as "0.00%" and
      // looks far worse than the one uncovered branch it actually is.
      branchCounts: `${data.branches.covered}/${data.branches.total}`,
      worst: Math.min(data.lines.pct, data.branches.pct, data.functions.pct),
    }))
    .filter((entry) => entry.worst < 100)
    .sort((a, b) => a.worst - b.worst)
    .slice(0, 5);

  if (files.length === 0) {
    console.log(bold('WEAKEST FILES'));
    console.log(`  ${green('every file is at 100% on all metrics')}\n`);
    return;
  }

  console.log(bold('WEAKEST FILES'));
  console.log(
    dim('  ' + 'File'.padEnd(50) + 'Lines'.padStart(8) + 'Branches'.padStart(10) + '  covered'),
  );
  for (const entry of files) {
    console.log(
      '  ' +
        entry.file.padEnd(50) +
        pct(entry.lines).padStart(8) +
        pct(entry.branches).padStart(10) +
        '  ' +
        dim(entry.branchCounts),
    );
  }
  console.log();
}

// --- main -------------------------------------------------------------------
if (!reuseLast) runSuite();

const summary = readJson(COVERAGE_SUMMARY, 'coverage summary');
const results = readJson(RESULTS_FILE, 'test results');
const total = summary.total;

console.log();
console.log(bold('INVENTORY API — QUALITY REPORT'));
console.log(
  dim(
    `  ${new Date().toLocaleString()}` +
      (fastMode ? '  ·  unit tests only, coverage is partial' : '') +
      (reuseLast ? '  ·  showing the previous run' : ''),
  ),
);
console.log();

const testsGreen = renderTests(results);
renderFailures(results);
renderCoverage(total);
const outcomes = renderGates(total, testsGreen);
renderWeakestFiles(summary);

console.log(dim(`  Detailed HTML report: coverage/index.html`));
if (fastMode) {
  console.log(
    yellow('  Unit tests only — run `npm run report` for the figure the pipelines enforce.'),
  );
}
console.log();

// Exit on the strictest gate, so this doubles as a pipeline check.
const strictest = outcomes[outcomes.length - 1];
process.exit(strictest.ok ? 0 : 1);
