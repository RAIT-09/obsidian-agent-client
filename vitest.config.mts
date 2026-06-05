import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// `obsidian` has no real module outside Obsidian, so alias it to a lightweight
// stub for unit tests. Only the pieces the tested pure functions need (Platform)
// are provided.
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
	resolve: {
		alias: {
			obsidian: fileURLToPath(
				new URL("./test/stubs/obsidian.ts", import.meta.url),
			),
		},
	},
});
