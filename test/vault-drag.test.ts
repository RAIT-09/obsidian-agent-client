import { describe, expect, it } from "vitest";
import {
	extractVaultPathsFromInternalDrag,
	extractVaultPathsFromObsidianUris,
} from "../src/utils/vault-drag";

describe("extractVaultPathsFromInternalDrag", () => {
	it("extracts a single Obsidian file drag", () => {
		expect(
			extractVaultPathsFromInternalDrag({
				type: "file",
				file: { path: "Projects/Requirements.md" },
			}),
		).toEqual(["Projects/Requirements.md"]);
	});

	it("extracts and de-duplicates a multi-file drag", () => {
		expect(
			extractVaultPathsFromInternalDrag({
				type: "files",
				files: [
					{ path: "a.md" },
					{ path: "folder/b.md" },
					{ path: "a.md" },
				],
			}),
		).toEqual(["a.md", "folder/b.md"]);
	});

	it("rejects unsupported or malformed internal drag items", () => {
		expect(extractVaultPathsFromInternalDrag(null)).toEqual([]);
		expect(
			extractVaultPathsFromInternalDrag({ type: "folder", file: {} }),
		).toEqual([]);
	});
});

describe("extractVaultPathsFromObsidianUris", () => {
	it("decodes current-vault Obsidian links", () => {
		expect(
			extractVaultPathsFromObsidianUris(
				"obsidian://open?vault=My%20Vault&file=Notes%2FProject%20plan.md",
				"My Vault",
			),
		).toEqual(["Notes/Project plan.md"]);
	});

	it("handles multiple URI-list entries", () => {
		expect(
			extractVaultPathsFromObsidianUris(
				[
					"# dragged files",
					"obsidian://open?vault=Vault&file=a.md",
					"obsidian://open?vault=Vault&file=b%20c.md",
				].join("\n"),
				"Vault",
			),
		).toEqual(["a.md", "b c.md"]);
	});

	it("rejects other vaults and malformed values", () => {
		expect(
			extractVaultPathsFromObsidianUris(
				"obsidian://open?vault=Other&file=secret.md not-a-url",
				"Vault",
			),
		).toEqual([]);
	});
});
