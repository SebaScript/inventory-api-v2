#!/usr/bin/env node
/**
 * Runs the test suite and prints, in one place, what both pipelines check:
 * the test success rate and the coverage against each environment's gate.
 *
 * Coverage does not depend on the environment — only the threshold does — so a
 * single run answers both questions.
 *
 *   npm run report
 */
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const GATES = [
  { env: 'Test', min: 60 },
  { env: 'Production', min: 85 },
];

// COVERAGE_MIN=0 so Jest always produces a full report; the gates are applied
// below. CI still enforces the real threshold through Jest itself.
const run = spawnSync('npx', ['jest', '--coverage', '--json', '--outputFile=coverage/results.json'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  shell: process.platform === 'win32',
  env: { ...process.env, COVERAGE_MIN: '0' },
});

if (run.status !== 0 && run.status !== 1) process.exit(run.status ?? 1);

const results = JSON.parse(readFileSync('coverage/results.json', 'utf8'));
const total = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8')).total;

const passed = results.numPassedTests;
const all = results.numTotalTests;
const testsOk = results.numFailedTests === 0;

console.log('\nQUALITY REPORT\n');
console.log(`Tests      ${passed}/${all} passed  (${((passed / all) * 100).toFixed(1)}%)`);
console.log(`Suites     ${results.numPassedTestSuites}/${results.numTotalTestSuites} passed\n`);

console.log('Coverage'.padEnd(14) + GATES.map((g) => `${g.env} ${g.min}%`.padStart(16)).join(''));
for (const metric of ['lines', 'statements', 'functions', 'branches']) {
  const pct = total[metric].pct;
  const cells = GATES.map((g) => (pct >= g.min ? 'PASS' : 'FAIL').padStart(16)).join('');
  console.log(`  ${metric.padEnd(12)}${`${pct}%`.padEnd(0)}`.padEnd(14) + cells + `   ${pct}%`);
}

console.log('\nGates');
let ok = true;
for (const gate of GATES) {
  const short = ['lines', 'statements', 'functions', 'branches'].filter((m) => total[m].pct < gate.min);
  const pass = testsOk && short.length === 0;
  ok = ok && (gate.env !== 'Production' || pass);
  console.log(`  ${`${gate.env} (>= ${gate.min}%)`.padEnd(24)}${pass ? 'PASS' : 'FAIL'}`);
  if (!testsOk) console.log('    blocked by failing tests');
  for (const m of short) console.log(`    ${m} at ${total[m].pct}%, needs ${gate.min}%`);
}

console.log('\nFull HTML report: coverage/index.html\n');
process.exit(ok ? 0 : 1);
