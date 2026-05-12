// §10.2.2 — schema resource. Schema version + JSON-LD context.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// schemas/cairn-v0.context.json lives at the repo root; the file is embedded into the build via copy.
// In tests/dev, we resolve from the repo root (../../../schemas).
let cachedContext: unknown;

function loadContext(): unknown {
	if (cachedContext) return cachedContext;
	const candidates = [
		resolve(__dirname, "../../../schemas/cairn-v0.context.json"),
		resolve(__dirname, "../../schemas/cairn-v0.context.json"),
		resolve(__dirname, "../schemas/cairn-v0.context.json"),
	];
	for (const path of candidates) {
		try {
			cachedContext = JSON.parse(readFileSync(path, "utf8"));
			return cachedContext;
		} catch {
			// try next
		}
	}
	cachedContext = { "@context": {} };
	return cachedContext;
}

export function readSchemaResource() {
	const payload = {
		schema_version: "cairn/0.1",
		context: loadContext(),
	};
	return {
		contents: [
			{
				uri: "cairn://schema",
				mimeType: "application/json",
				text: JSON.stringify(payload),
			},
		],
	};
}
