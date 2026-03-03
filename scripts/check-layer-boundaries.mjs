import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const TARGET_EXTENSIONS = new Set([".ts", ".tsx"]);
const SCAN_ROOTS = ["src/components", "src/hooks", "src/application"];
const EXCLUDED_FILES = new Set(["AGENTS.md"]);
const ALLOWED_VIOLATIONS = new Set([]);

function walk(dir) {
	const entries = readdirSync(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		if (entry.name.startsWith(".")) {
			continue;
		}

		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...walk(fullPath));
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		if (EXCLUDED_FILES.has(entry.name)) {
			continue;
		}

		if (TARGET_EXTENSIONS.has(extname(entry.name))) {
			files.push(fullPath);
		}
	}

	return files;
}

const importPattern = /\bfrom\s+["']([^"']+)["']/g;
const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const violations = [];

for (const root of SCAN_ROOTS) {
	if (!existsSync(root)) {
		continue;
	}

	for (const filePath of walk(root)) {
		if (ALLOWED_VIOLATIONS.has(filePath)) {
			continue;
		}

		const content = readFileSync(filePath, "utf8");
		const lines = content.split(/\r?\n/);

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			importPattern.lastIndex = 0;
			dynamicImportPattern.lastIndex = 0;

			const importMatch = importPattern.exec(line);
			if (
				importMatch &&
				(importMatch[1].includes("/adapters/") ||
					importMatch[1].startsWith("adapters/") ||
					importMatch[1].includes("../adapters/"))
			) {
				violations.push({
					filePath,
					line: i + 1,
					modulePath: importMatch[1],
				});
				continue;
			}

			const dynamicMatch = dynamicImportPattern.exec(line);
			if (
				dynamicMatch &&
				(dynamicMatch[1].includes("/adapters/") ||
					dynamicMatch[1].startsWith("adapters/") ||
					dynamicMatch[1].includes("../adapters/"))
			) {
				violations.push({
					filePath,
					line: i + 1,
					modulePath: dynamicMatch[1],
				});
			}
		}
	}
}

if (violations.length > 0) {
	console.error(
		"Layer boundary violations found: components/hooks/application must not import adapters/ directly.",
	);
	for (const violation of violations) {
		console.error(
			`- ${violation.filePath}:${violation.line} -> ${violation.modulePath}`,
		);
	}
	process.exit(1);
}

console.log("Layer boundary check passed.");
