#!/usr/bin/env node
// #16 wiki-check CLI. Walks ./wiki and prints errors + warnings. Exits non-zero on
// any error; warnings are surfaced but do not fail CI.
import { resolve } from "node:path";
import { lintWiki } from "./lint.mjs";

const root = resolve(process.argv[2] ?? "wiki");
const { errors, warnings } = await lintWiki(root);

for (const w of warnings) console.warn(`warn  ${w.path}: ${w.message}`);
for (const e of errors) console.error(`error ${e.path}: ${e.message}`);

if (errors.length) {
	console.error(`\n${errors.length} error(s), ${warnings.length} warning(s) in ${root}`);
	process.exit(1);
}
console.log(`wiki-check: 0 errors, ${warnings.length} warning(s) in ${root}`);
