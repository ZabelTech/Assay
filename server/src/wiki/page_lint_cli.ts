#!/usr/bin/env node
// #16 wiki-check CLI. Walks the given root (default: ./wiki), prints errors and
// warnings, exits non-zero on any error. Lives in the server tree so production
// builds can run the same lint logic that CI uses.
import { resolve } from "node:path";
import { lintWiki } from "./page_lint.js";

const root = resolve(process.argv[2] ?? "wiki");
const { errors, warnings } = await lintWiki(root);

for (const w of warnings) console.warn(`warn  ${w.path}: ${w.message}`);
for (const e of errors) console.error(`error ${e.path}: ${e.message}`);

if (errors.length) {
	console.error(`\n${errors.length} error(s), ${warnings.length} warning(s) in ${root}`);
	process.exit(1);
}
console.log(`wiki-check: 0 errors, ${warnings.length} warning(s) in ${root}`);
