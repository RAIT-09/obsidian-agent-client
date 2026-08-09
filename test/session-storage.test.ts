import { describe, it, expect, vi } from "vitest";
import { SessionStorage } from "../src/services/session-storage";
import type { SavedSessionInfo } from "../src/types/session";
import type { ChatMessage } from "../src/types/chat";

// SessionStorage only needs a tiny slice of the plugin (vault adapter +
// configDir) and a {getSnapshot, updateSettings} settings access. We stub both
// and cast to the real constructor parameter types (the settings-access
// interface is module-private, so we borrow it via ConstructorParameters).
type StorageState = {
	savedSessions: SavedSessionInfo[];
	windowsWslMode: boolean;
};

// Intentionally NOT ".obsidian": the code must derive the path from
// Vault#configDir, not assume the default config folder.
const CONFIG_DIR = "test-config";
const SESSIONS_DIR = `${CONFIG_DIR}/plugins/agent-client/sessions`;
const filePath = (sessionId: string) => `${SESSIONS_DIR}/${sessionId}.json`;

function makeSession(
	partial: Partial<SavedSessionInfo> & Pick<SavedSessionInfo, "sessionId">,
): SavedSessionInfo {
	return {
		agentId: "claude",
		cwd: "/vault",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...partial,
	};
}

function makeStorage() {
	const state: StorageState = { savedSessions: [], windowsWslMode: false };
	// Map-backed in-memory FS: path → file content.
	const files = new Map<string, string>();
	const adapter = {
		exists: vi.fn(async (p: string) => files.has(p)),
		remove: vi.fn(async (p: string) => {
			files.delete(p);
		}),
		read: vi.fn(async (p: string) => {
			const content = files.get(p);
			if (content === undefined) throw new Error(`ENOENT: ${p}`);
			return content;
		}),
		write: vi.fn(async (p: string, content: string) => {
			files.set(p, content);
		}),
		mkdir: vi.fn(async () => {}),
	};
	const plugin = {
		app: { vault: { configDir: CONFIG_DIR, adapter } },
	};
	const settingsAccess = {
		getSnapshot: () => state,
		updateSettings: async (updates: Partial<StorageState>) => {
			Object.assign(state, updates);
		},
	};
	const storage = new SessionStorage(
		plugin as unknown as ConstructorParameters<typeof SessionStorage>[0],
		settingsAccess as unknown as ConstructorParameters<
			typeof SessionStorage
		>[1],
	);
	return { storage, state, adapter, files };
}

describe("SessionStorage — getSavedSessionByEmbedId (#5/#11)", () => {
	it("returns the most-recently-updated match", () => {
		const { storage, state } = makeStorage();
		state.savedSessions = [
			makeSession({
				sessionId: "old",
				embedId: "blk1",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
			makeSession({
				sessionId: "new",
				embedId: "blk1",
				updatedAt: "2026-02-01T00:00:00.000Z",
			}),
		];
		expect(storage.getSavedSessionByEmbedId("blk1")?.sessionId).toBe("new");
	});

	it("returns undefined when no row carries the embedId", () => {
		const { storage, state } = makeStorage();
		state.savedSessions = [makeSession({ sessionId: "s1" })];
		expect(storage.getSavedSessionByEmbedId("missing")).toBeUndefined();
	});

	it("resolves regardless of agentId/cwd (rename/switch safe)", () => {
		const { storage, state } = makeStorage();
		state.savedSessions = [
			makeSession({
				sessionId: "s1",
				embedId: "blk1",
				agentId: "codex",
				cwd: "/some/other/dir",
			}),
		];
		expect(storage.getSavedSessionByEmbedId("blk1")?.sessionId).toBe("s1");
	});
});

describe("SessionStorage — embedded persist sessions accumulate (no dedup/delete)", () => {
	it("keeps a block's past conversations in history and never deletes a transcript", async () => {
		const { storage, state, adapter, files } = makeStorage();
		state.savedSessions = [
			makeSession({ sessionId: "s1", embedId: "blk1" }),
		];
		files.set(filePath("s1"), "{}");

		await storage.saveSession(
			makeSession({ sessionId: "s2", embedId: "blk1" }),
		);

		// The new conversation accumulates; the old one stays recoverable.
		expect(state.savedSessions).toHaveLength(2);
		expect(state.savedSessions.map((s) => s.sessionId).sort()).toEqual([
			"s1",
			"s2",
		]);
		expect(adapter.remove).not.toHaveBeenCalled();
	});

	it("keeps the old-agent conversation when the block switches agents (restore uses newest)", async () => {
		const { storage, state, adapter, files } = makeStorage();
		state.savedSessions = [
			makeSession({
				sessionId: "s1",
				embedId: "blk1",
				agentId: "claude",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
		];
		files.set(filePath("s1"), "{}");

		await storage.saveSession(
			makeSession({
				sessionId: "s2",
				embedId: "blk1",
				agentId: "codex",
				updatedAt: "2026-02-01T00:00:00.000Z",
			}),
		);

		expect(state.savedSessions).toHaveLength(2);
		// Both remain in history; restore resolves the newest embedId match.
		expect(storage.getSavedSessionByEmbedId("blk1")?.sessionId).toBe("s2");
		expect(adapter.remove).not.toHaveBeenCalled();
	});

	it("updates in place (no duplicate row) when the same session is re-saved", async () => {
		const { storage, state, adapter } = makeStorage();
		state.savedSessions = [
			makeSession({ sessionId: "s1", embedId: "blk1", title: "old" }),
		];

		await storage.saveSession(
			makeSession({ sessionId: "s1", embedId: "blk1", title: "new" }),
		);

		expect(state.savedSessions).toHaveLength(1);
		expect(state.savedSessions[0].title).toBe("new");
		expect(adapter.remove).not.toHaveBeenCalled();
	});
});

describe("SessionStorage — rename does not bump updatedAt (last-activity semantics)", () => {
	it("changes the title but keeps updatedAt (rename is not activity)", async () => {
		const { storage, state } = makeStorage();
		state.savedSessions = [
			makeSession({
				sessionId: "s1",
				title: "old",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
		];

		await storage.updateSessionTitle("s1", "renamed");

		expect(state.savedSessions[0].title).toBe("renamed");
		expect(state.savedSessions[0].updatedAt).toBe(
			"2026-01-01T00:00:00.000Z",
		);
	});

	it("renaming an OLD embedId conversation does not hijack the block's restore", async () => {
		const { storage, state } = makeStorage();
		state.savedSessions = [
			makeSession({
				sessionId: "old-chat",
				embedId: "blk1",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
			makeSession({
				sessionId: "current-chat",
				embedId: "blk1",
				updatedAt: "2026-02-01T00:00:00.000Z",
			}),
		];

		await storage.updateSessionTitle("old-chat", "renamed old chat");

		// The block still resolves its actual current conversation.
		expect(storage.getSavedSessionByEmbedId("blk1")?.sessionId).toBe(
			"current-chat",
		);
	});
});

describe("SessionStorage — non-embedded saves keep sessionId fallback", () => {
	it("dedups by sessionId and never deletes a transcript", async () => {
		const { storage, state, adapter } = makeStorage();
		state.savedSessions = [makeSession({ sessionId: "s1", title: "old" })];

		await storage.saveSession(
			makeSession({ sessionId: "s1", title: "new" }),
		);
		expect(state.savedSessions).toHaveLength(1);
		expect(state.savedSessions[0].title).toBe("new");

		await storage.saveSession(makeSession({ sessionId: "s2" }));
		expect(state.savedSessions).toHaveLength(2);
		expect(adapter.remove).not.toHaveBeenCalled();
	});
});

describe("SessionStorage — cap eviction is LRU by updatedAt, not insertion order", () => {
	const CAP = 50;
	const iso = (minute: number) =>
		new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();

	/**
	 * Seed a full list whose array position is INVERSE to recency of use:
	 * index 0 (newest inserted) has the OLDEST updatedAt, the tail (oldest
	 * inserted) has the NEWEST. A positional pop() would evict the tail —
	 * the most recently used entry.
	 */
	const seedInverse = (count: number) =>
		Array.from({ length: count }, (_, i) =>
			makeSession({ sessionId: `s${i}`, updatedAt: iso(i) }),
		);

	it("evicts the entry with the oldest updatedAt when the cap is exceeded", async () => {
		const { storage, state, adapter } = makeStorage();
		state.savedSessions = seedInverse(CAP);

		await storage.saveSession(
			makeSession({ sessionId: "brand-new", updatedAt: iso(1000) }),
		);

		expect(state.savedSessions).toHaveLength(CAP);
		// s0 sits at the array head (newest inserted) but is the least
		// recently used — it must be the one to go.
		expect(state.savedSessions.some((s) => s.sessionId === "s0")).toBe(
			false,
		);
		expect(
			state.savedSessions.some((s) => s.sessionId === "brand-new"),
		).toBe(true);
		// Eviction removes the index entry only — never a transcript file.
		expect(adapter.remove).not.toHaveBeenCalled();
	});

	it("keeps an oldest-inserted entry that is still in recent use (DATA-2)", async () => {
		const { storage, state } = makeStorage();
		state.savedSessions = seedInverse(CAP);

		await storage.saveSession(
			makeSession({ sessionId: "brand-new", updatedAt: iso(1000) }),
		);

		// The tail entry (oldest inserted, newest updatedAt) survives; the old
		// positional pop() would have dropped exactly this one.
		expect(
			state.savedSessions.some((s) => s.sessionId === `s${CAP - 1}`),
		).toBe(true);
	});

	it("trims multiple entries in LRU order when the list is already over the cap", async () => {
		const { storage, state } = makeStorage();
		// e.g. data.json hand-edited or written by a future version.
		state.savedSessions = seedInverse(CAP + 2);

		await storage.saveSession(
			makeSession({ sessionId: "brand-new", updatedAt: iso(1000) }),
		);

		expect(state.savedSessions).toHaveLength(CAP);
		for (const evicted of ["s0", "s1", "s2"]) {
			expect(
				state.savedSessions.some((s) => s.sessionId === evicted),
			).toBe(false);
		}
	});

	it("enforces the cap on updateSessionTitle's createIfMissing path too", async () => {
		const { storage, state } = makeStorage();
		state.savedSessions = seedInverse(CAP);

		await storage.updateSessionTitle("brand-new", "created by rename", {
			agentId: "claude",
			cwd: "/vault",
		});

		expect(state.savedSessions).toHaveLength(CAP);
		expect(
			state.savedSessions.some((s) => s.sessionId === "brand-new"),
		).toBe(true);
		// The created entry's updatedAt is "now" (far newer than the seeds),
		// so the least recently used seed is the one evicted.
		expect(state.savedSessions.some((s) => s.sessionId === "s0")).toBe(
			false,
		);
	});
});

describe("SessionStorage — transcript metadata snapshot (self-contained archive)", () => {
	const makeMessage = (text: string): ChatMessage => ({
		id: "m1",
		role: "user",
		content: [{ type: "text", text }],
		timestamp: new Date("2026-03-01T00:00:00.000Z"),
	});
	const parseFile = (files: Map<string, string>, sessionId: string) =>
		JSON.parse(files.get(filePath(sessionId)) as string) as Record<
			string,
			unknown
		>;

	it("snapshots the index entry (cwd/title/embedId/timestamps) into the file", async () => {
		const { storage, state, files } = makeStorage();
		state.savedSessions = [
			makeSession({
				sessionId: "s1",
				embedId: "blk1",
				title: "My chat",
				cwd: "/custom/dir",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-02-01T00:00:00.000Z",
			}),
		];

		await storage.saveSessionMessages("s1", "claude", [makeMessage("hi")]);

		const data = parseFile(files, "s1");
		expect(data.cwd).toBe("/custom/dir");
		expect(data.title).toBe("My chat");
		expect(data.embedId).toBe("blk1");
		expect(data.createdAt).toBe("2026-01-01T00:00:00.000Z");
		expect(data.updatedAt).toBe("2026-02-01T00:00:00.000Z");
	});

	it("omits absent optional fields instead of writing null", async () => {
		const { storage, state, files } = makeStorage();
		// No title, no embedId on the index entry.
		state.savedSessions = [makeSession({ sessionId: "s1" })];

		await storage.saveSessionMessages("s1", "claude", [makeMessage("hi")]);

		const data = parseFile(files, "s1");
		expect("title" in data).toBe(false);
		expect("embedId" in data).toBe(false);
		expect(data.cwd).toBe("/vault");
	});

	it("carries the previous snapshot over when the index entry is gone", async () => {
		const { storage, state, files } = makeStorage();
		files.set(
			filePath("s1"),
			JSON.stringify({
				version: 1,
				sessionId: "s1",
				agentId: "claude",
				cwd: "/old/dir",
				title: "Evicted chat",
				embedId: "blk1",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-02-01T00:00:00.000Z",
				messages: [],
				savedAt: "2026-02-01T00:00:00.000Z",
			}),
		);
		state.savedSessions = []; // index entry evicted while session open

		await storage.saveSessionMessages("s1", "claude", [
			makeMessage("more"),
		]);

		const data = parseFile(files, "s1");
		expect(data.cwd).toBe("/old/dir");
		expect(data.title).toBe("Evicted chat");
		expect(data.embedId).toBe("blk1");
		// ...while the messages are the fresh in-memory ones.
		expect(data.messages as unknown[]).toHaveLength(1);
	});

	it("still loads messages from a pre-feature file without a snapshot", async () => {
		const { storage, files } = makeStorage();
		files.set(
			filePath("legacy"),
			JSON.stringify({
				version: 1,
				sessionId: "legacy",
				agentId: "claude",
				messages: [
					{
						id: "m1",
						role: "user",
						content: [{ type: "text", text: "old" }],
						timestamp: "2026-01-01T00:00:00.000Z",
					},
				],
				savedAt: "2026-01-01T00:00:00.000Z",
			}),
		);

		const messages = await storage.loadSessionMessages("legacy");
		expect(messages).toHaveLength(1);
		expect(messages?.[0].timestamp).toBeInstanceOf(Date);
	});
});

describe("SessionStorage — rename syncs the transcript's title snapshot", () => {
	it("patches the title in the file and leaves everything else intact", async () => {
		const { storage, state, files } = makeStorage();
		state.savedSessions = [
			makeSession({ sessionId: "s1", title: "old title" }),
		];
		files.set(
			filePath("s1"),
			JSON.stringify({
				version: 1,
				sessionId: "s1",
				agentId: "claude",
				cwd: "/vault",
				title: "old title",
				messages: [
					{
						id: "m1",
						role: "user",
						content: [{ type: "text", text: "hello" }],
						timestamp: "2026-01-01T00:00:00.000Z",
					},
				],
				savedAt: "2026-01-01T00:00:00.000Z",
			}),
		);

		await storage.updateSessionTitle("s1", "renamed");

		const data = JSON.parse(files.get(filePath("s1")) as string) as Record<
			string,
			unknown
		>;
		expect(data.title).toBe("renamed");
		expect(data.messages as unknown[]).toHaveLength(1);
		expect(data.cwd).toBe("/vault");
		expect(data.savedAt).toBe("2026-01-01T00:00:00.000Z");
	});

	it("is a no-op when no transcript file exists", async () => {
		const { storage, state, files } = makeStorage();
		state.savedSessions = [makeSession({ sessionId: "s1", title: "old" })];

		await storage.updateSessionTitle("s1", "renamed");

		expect(state.savedSessions[0].title).toBe("renamed");
		expect(files.has(filePath("s1"))).toBe(false);
	});

	it("silently skips a corrupt file while the rename itself succeeds", async () => {
		const { storage, state, files } = makeStorage();
		state.savedSessions = [makeSession({ sessionId: "s1", title: "old" })];
		files.set(filePath("s1"), "not json");

		await storage.updateSessionTitle("s1", "renamed");

		expect(state.savedSessions[0].title).toBe("renamed");
		expect(files.get(filePath("s1"))).toBe("not json");
	});

	it("a rename racing a turn-end save cannot clobber the newer messages", async () => {
		const { storage, state, files, adapter } = makeStorage();
		state.savedSessions = [
			makeSession({ sessionId: "s1", title: "old title" }),
		];
		files.set(
			filePath("s1"),
			JSON.stringify({
				version: 1,
				sessionId: "s1",
				agentId: "claude",
				title: "old title",
				messages: [],
				savedAt: "2026-01-01T00:00:00.000Z",
			}),
		);

		// Gate the rename's file write (the first write in this test) so the
		// turn-end save is issued while the rename is mid-flight — the exact
		// interleaving that used to let the rename's stale full-file rewrite
		// land last and erase the newer messages.
		let openGate!: () => void;
		const gate = new Promise<void>((resolve) => (openGate = resolve));
		let gated = false;
		adapter.write.mockImplementation(async (p: string, content: string) => {
			if (!gated) {
				gated = true;
				await gate;
			}
			files.set(p, content);
		});

		const rename = storage.updateSessionTitle("s1", "renamed");
		// Let the rename reach its (gated) file write.
		await new Promise((resolve) => setTimeout(resolve, 0));

		const save = storage.saveSessionMessages("s1", "claude", [
			{
				id: "m1",
				role: "user",
				content: [{ type: "text", text: "newest" }],
				timestamp: new Date("2026-03-01T00:00:00.000Z"),
			},
		]);
		await new Promise((resolve) => setTimeout(resolve, 0));

		openGate();
		await Promise.all([rename, save]);

		// The save serializes behind the rename on the session lock, so the
		// final file carries BOTH the new title and the newer messages.
		const data = JSON.parse(files.get(filePath("s1")) as string) as Record<
			string,
			unknown
		>;
		expect(data.title).toBe("renamed");
		expect(data.messages as unknown[]).toHaveLength(1);
	});
});

describe("SessionStorage — stored permissions are settled on load", () => {
	function transcriptWithPermission(
		permissionRequest: Record<string, unknown>,
	): string {
		return JSON.stringify({
			version: 1,
			sessionId: "s1",
			agentId: "claude",
			savedAt: "2026-01-01T00:00:00.000Z",
			messages: [
				{
					id: "m1",
					role: "assistant",
					content: [
						{
							type: "tool_call",
							toolCallId: "call_1",
							status: "pending",
							permissionRequest,
						},
					],
					timestamp: "2026-01-01T00:00:00.000Z",
				},
			],
		});
	}

	function loadedPermission(messages: ChatMessage[] | null) {
		const content = messages?.[0]?.content[0];
		if (content?.type !== "tool_call") throw new Error("expected tool_call");
		return content.permissionRequest;
	}

	it("cancels a request left undecided by a crash", async () => {
		const { storage, files } = makeStorage();
		// An app that exits normally records the cancellation itself; this is
		// the state left behind when it does not get the chance.
		files.set(
			filePath("s1"),
			transcriptWithPermission({
				requestId: "r1",
				options: [],
				isActive: true,
			}),
		);

		const permission = loadedPermission(
			await storage.loadSessionMessages("s1"),
		);

		// Cancelled, not merely inactive: an undecided request keeps its tool
		// call hidden from the transcript.
		expect(permission?.isActive).toBe(false);
		expect(permission?.isCancelled).toBe(true);
	});

	it("leaves an answered request untouched", async () => {
		const { storage, files } = makeStorage();
		files.set(
			filePath("s1"),
			transcriptWithPermission({
				requestId: "r1",
				options: [],
				isActive: false,
				selectedOptionId: "allow",
			}),
		);

		const permission = loadedPermission(
			await storage.loadSessionMessages("s1"),
		);

		expect(permission?.selectedOptionId).toBe("allow");
		expect(permission?.isCancelled).toBeUndefined();
	});
});
