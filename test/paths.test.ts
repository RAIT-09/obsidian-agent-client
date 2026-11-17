import { describe, it, expect } from "vitest";
import { resolveInternalLinkHref } from "../src/utils/paths";

describe("resolveInternalLinkHref", () => {
	const unixVault = "/Users/me/vault";
	const winVault = "C:\\Users\\me\\vault";

	it("passes wikilink-style targets through", () => {
		expect(resolveInternalLinkHref("My Note", unixVault, false)).toBe(
			"My Note",
		);
		expect(
			resolveInternalLinkHref("folder/My Note#Heading", unixVault, false),
		).toBe("folder/My Note#Heading");
	});

	it("URI-decodes the href", () => {
		expect(
			resolveInternalLinkHref("folder/My%20Note.md", unixVault, false),
		).toBe("folder/My Note.md");
	});

	it("keeps a malformed escape verbatim instead of throwing", () => {
		expect(resolveInternalLinkHref("100% done", unixVault, false)).toBe(
			"100% done",
		);
	});

	it("converts an absolute path inside the vault to vault-relative", () => {
		expect(
			resolveInternalLinkHref(
				"/Users/me/vault/folder/note.md",
				unixVault,
				false,
			),
		).toBe("folder/note.md");
	});

	it("tolerates a trailing slash on the vault base", () => {
		expect(
			resolveInternalLinkHref(
				"/Users/me/vault/note.md",
				"/Users/me/vault/",
				false,
			),
		).toBe("note.md");
	});

	it("does not treat a sibling directory sharing the prefix as the vault", () => {
		expect(
			resolveInternalLinkHref(
				"/Users/me/vault2/note.md",
				unixVault,
				false,
			),
		).toBeNull();
	});

	it("keeps the heading suffix of an absolute vault path", () => {
		expect(
			resolveInternalLinkHref(
				"/Users/me/vault/note.md#A/../B",
				unixVault,
				false,
			),
		).toBe("note.md#A/../B");
	});

	it("does not let heading text steer the path into the vault", () => {
		expect(
			resolveInternalLinkHref(
				"/Users/me/outside.md#A/../vault/note.md",
				unixVault,
				false,
			),
		).toBeNull();
		// `v#` is not how the vault root continues, so this `#` starts a heading
		expect(
			resolveInternalLinkHref(
				"/Users/me/v#x/../vault/note.md",
				unixVault,
				false,
			),
		).toBeNull();
	});

	it("does not split at a # in the vault root's own path", () => {
		const hashVault = "/Users/me/#work/vault";
		expect(
			resolveInternalLinkHref(
				"/Users/me/#work/vault/note.md",
				hashVault,
				false,
			),
		).toBe("note.md");
		expect(
			resolveInternalLinkHref(
				"/Users/me/#work/vault/note.md#A/../B",
				hashVault,
				false,
			),
		).toBe("note.md#A/../B");
		expect(
			resolveInternalLinkHref(
				"/Users/me/#work/other/note.md",
				hashVault,
				false,
			),
		).toBeNull();
	});

	it("rejects an absolute path that escapes the vault via ..", () => {
		expect(
			resolveInternalLinkHref(
				"/Users/me/vault/../outside/note.md",
				unixVault,
				false,
			),
		).toBeNull();
		expect(
			resolveInternalLinkHref(
				"C:\\Users\\me\\vault\\..\\outside\\note.md",
				winVault,
				false,
			),
		).toBeNull();
	});

	it("accepts an absolute path that reaches the vault via ..", () => {
		expect(
			resolveInternalLinkHref(
				"/Users/me/other/../vault/./folder/note.md",
				unixVault,
				false,
			),
		).toBe("folder/note.md");
	});

	it("keeps the UNC prefix distinct when comparing", () => {
		const uncVault = "\\\\server\\share\\vault";
		expect(
			resolveInternalLinkHref(
				"\\\\server\\share\\vault\\note.md",
				uncVault,
				false,
			),
		).toBe("note.md");
		expect(
			resolveInternalLinkHref(
				"/server/share/vault/note.md",
				uncVault,
				false,
			),
		).toBeNull();
	});

	it("returns null for a backslash UNC path outside the vault", () => {
		expect(
			resolveInternalLinkHref(
				"\\\\other\\share\\note.md",
				"\\\\server\\share\\vault",
				false,
			),
		).toBeNull();
		expect(
			resolveInternalLinkHref("\\\\other\\share\\note.md", null, false),
		).toBeNull();
	});

	it("returns null for an absolute path outside the vault", () => {
		expect(
			resolveInternalLinkHref("/etc/hosts", unixVault, false),
		).toBeNull();
		expect(
			resolveInternalLinkHref("D:\\other\\note.md", winVault, false),
		).toBeNull();
	});

	it("matches Windows paths regardless of slash direction", () => {
		expect(
			resolveInternalLinkHref(
				"C:/Users/me/vault/folder/note.md",
				winVault,
				false,
			),
		).toBe("folder/note.md");
	});

	it("reads /mnt/<drive>/ paths as Windows paths in WSL mode", () => {
		expect(
			resolveInternalLinkHref(
				"/mnt/c/Users/me/vault/folder/note.md",
				winVault,
				true,
			),
		).toBe("folder/note.md");
	});

	it("keeps slashes in the heading in WSL mode", () => {
		expect(
			resolveInternalLinkHref(
				"/mnt/c/Users/me/vault/note.md#A/B",
				winVault,
				true,
			),
		).toBe("note.md#A/B");
	});

	it("leaves /mnt/ paths alone outside WSL mode", () => {
		expect(
			resolveInternalLinkHref(
				"/mnt/c/Users/me/vault/note.md",
				winVault,
				false,
			),
		).toBeNull();
	});

	it("passes relative paths through without a filesystem vault", () => {
		expect(resolveInternalLinkHref("note.md", null, false)).toBe("note.md");
		expect(resolveInternalLinkHref("/abs/note.md", null, false)).toBeNull();
	});
});
