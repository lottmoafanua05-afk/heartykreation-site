// Build guard. Runs after the Tailwind build via `npm run build`.
//
// A Tailwind build can "succeed" while producing a near-empty stylesheet — a bad
// @source glob, a renamed HTML file, or a stray source(none) will emit a valid but
// contentless CSS file rather than an error. Deploying that would strip the site to
// unstyled HTML with a green checkmark on the deployment. Both stylesheets are
// comfortably over 13 KB, so anything under 5 KB means something is wrong: fail the
// build loudly instead of shipping it.

import { statSync } from 'node:fs';

const MIN_BYTES = 5 * 1024;
const outputs = ['dist/site.css', 'dist/blog.css'];

let failed = false;

for (const file of outputs) {
  let size;
  try {
    size = statSync(file).size;
  } catch {
    console.error(`✗ ${file} — missing (the Tailwind build did not produce it)`);
    failed = true;
    continue;
  }

  if (size < MIN_BYTES) {
    console.error(`✗ ${file} — ${size} bytes, under the ${MIN_BYTES} byte floor`);
    failed = true;
  } else {
    console.log(`✓ ${file} — ${size} bytes`);
  }
}

if (failed) {
  console.error('\nBuild guard failed: refusing to deploy an empty or missing stylesheet.');
  process.exit(1);
}

console.log('Build guard passed.');
