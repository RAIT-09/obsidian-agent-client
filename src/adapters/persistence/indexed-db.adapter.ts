/**
 * IndexedDB adapter for persisting chat sessions and messages.
 */

import type {
	IPersistence,
	PersistedSession,
	SessionSummary,
	ListSessionsOptions,
} from "../../core/domain/ports/persistence.port";
import type { ChatMessage } from "../../core/domain/models/chat-message";

const DB_NAME = "agent-client-db";
const DB_VERSION = 1;
const SESSIONS_STORE = "sessions";
const MESSAGES_STORE = "messages";

interface StoredSession extends Omit<PersistedSession, "createdAt" | "lastActivityAt"> {
	createdAt: string;
	lastActivityAt: string;
}

interface StoredMessage {
	id: string;
	sessionId: string;
	data: string; // JSON stringified ChatMessage
	index: number; // Message order within session
}

/**
 * IndexedDB implementation of the persistence interface.
 */
export class IndexedDBAdapter implements IPersistence {
	private db: IDBDatabase | null = null;
	private initPromise: Promise<void> | null = null;

	constructor() {
		this.initPromise = this.initialize();
	}

	private async initialize(): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onerror = () => {
				console.error("[IndexedDB] Failed to open database:", request.error);
				reject(request.error);
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Sessions store
				if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
					const sessionsStore = db.createObjectStore(SESSIONS_STORE, { keyPath: "sessionId" });
					sessionsStore.createIndex("by-date", "lastActivityAt", { unique: false });
					sessionsStore.createIndex("by-agent", "agentId", { unique: false });
				}

				// Messages store
				if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
					const messagesStore = db.createObjectStore(MESSAGES_STORE, { keyPath: "id" });
					messagesStore.createIndex("by-session", "sessionId", { unique: false });
				}
			};
		});
	}

	private async ensureDb(): Promise<IDBDatabase> {
		await this.initPromise;
		if (!this.db) {
			throw new Error("Database not initialized");
		}
		return this.db;
	}

	async saveSession(session: PersistedSession): Promise<void> {
		const db = await this.ensureDb();
		const stored: StoredSession = {
			...session,
			createdAt: session.createdAt.toISOString(),
			lastActivityAt: session.lastActivityAt.toISOString(),
		};

		return new Promise((resolve, reject) => {
			const tx = db.transaction(SESSIONS_STORE, "readwrite");
			const store = tx.objectStore(SESSIONS_STORE);
			const request = store.put(stored);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	async getSession(sessionId: string): Promise<PersistedSession | null> {
		const db = await this.ensureDb();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(SESSIONS_STORE, "readonly");
			const store = tx.objectStore(SESSIONS_STORE);
			const request = store.get(sessionId);

			request.onsuccess = () => {
				const stored = request.result as StoredSession | undefined;
				if (!stored) {
					resolve(null);
					return;
				}
				resolve({
					...stored,
					createdAt: new Date(stored.createdAt),
					lastActivityAt: new Date(stored.lastActivityAt),
				});
			};
			request.onerror = () => reject(request.error);
		});
	}

	async listSessions(options: ListSessionsOptions = {}): Promise<SessionSummary[]> {
		const db = await this.ensureDb();
		const { limit = 50, offset = 0, agentId } = options;

		return new Promise((resolve, reject) => {
			const tx = db.transaction([SESSIONS_STORE, MESSAGES_STORE], "readonly");
			const sessionsStore = tx.objectStore(SESSIONS_STORE);
			const messagesStore = tx.objectStore(MESSAGES_STORE);

			const results: SessionSummary[] = [];
			const index = sessionsStore.index("by-date");
			const request = index.openCursor(null, "prev"); // Newest first

			let skipped = 0;

			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor || results.length >= limit) {
					resolve(results);
					return;
				}

				const stored = cursor.value as StoredSession;

				// Filter by agent if specified
				if (agentId && stored.agentId !== agentId) {
					cursor.continue();
					return;
				}

				// Handle offset
				if (skipped < offset) {
					skipped++;
					cursor.continue();
					return;
				}

				// Get first message preview
				const msgIndex = messagesStore.index("by-session");
				const msgRequest = msgIndex.openCursor(IDBKeyRange.only(stored.sessionId));

				msgRequest.onsuccess = () => {
					let preview = "";
					const msgCursor = msgRequest.result;
					if (msgCursor) {
						const storedMsg = msgCursor.value as StoredMessage;
						try {
							const msg = JSON.parse(storedMsg.data) as ChatMessage;
							if (msg.role === "user" && msg.content.length > 0) {
								const firstContent = msg.content[0];
								if (firstContent.type === "text") {
									preview = firstContent.text.slice(0, 100);
								}
							}
						} catch {
							// Ignore parse errors
						}
					}

					results.push({
						sessionId: stored.sessionId,
						agentId: stored.agentId,
						agentDisplayName: stored.agentDisplayName,
						createdAt: new Date(stored.createdAt),
						lastActivityAt: new Date(stored.lastActivityAt),
						messageCount: stored.messageCount,
						preview,
					});

					cursor.continue();
				};
			};

			request.onerror = () => reject(request.error);
		});
	}

	async deleteSession(sessionId: string): Promise<void> {
		const db = await this.ensureDb();

		return new Promise((resolve, reject) => {
			const tx = db.transaction([SESSIONS_STORE, MESSAGES_STORE], "readwrite");
			const sessionsStore = tx.objectStore(SESSIONS_STORE);
			const messagesStore = tx.objectStore(MESSAGES_STORE);

			// Delete session
			sessionsStore.delete(sessionId);

			// Delete all messages for this session
			const index = messagesStore.index("by-session");
			const range = IDBKeyRange.only(sessionId);
			const request = index.openCursor(range);

			request.onsuccess = () => {
				const cursor = request.result;
				if (cursor) {
					cursor.delete();
					cursor.continue();
				}
			};

			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	async saveMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
		const db = await this.ensureDb();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(MESSAGES_STORE, "readwrite");
			const store = tx.objectStore(MESSAGES_STORE);

			// First delete existing messages
			const index = store.index("by-session");
			const range = IDBKeyRange.only(sessionId);
			const deleteRequest = index.openCursor(range);

			deleteRequest.onsuccess = () => {
				const cursor = deleteRequest.result;
				if (cursor) {
					cursor.delete();
					cursor.continue();
				} else {
					// All deleted, now add new messages
					messages.forEach((msg, idx) => {
						const stored: StoredMessage = {
							id: msg.id,
							sessionId,
							data: JSON.stringify(msg),
							index: idx,
						};
						store.put(stored);
					});
				}
			};

			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	async getMessages(sessionId: string): Promise<ChatMessage[]> {
		const db = await this.ensureDb();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(MESSAGES_STORE, "readonly");
			const store = tx.objectStore(MESSAGES_STORE);
			const index = store.index("by-session");
			const range = IDBKeyRange.only(sessionId);
			const request = index.getAll(range);

			request.onsuccess = () => {
				const stored = request.result as StoredMessage[];
				const messages = stored
					.sort((a, b) => a.index - b.index)
					.map((s) => {
						const msg = JSON.parse(s.data) as ChatMessage;
						// Restore Date objects
						msg.timestamp = new Date(msg.timestamp);
						return msg;
					});
				resolve(messages);
			};
			request.onerror = () => reject(request.error);
		});
	}

	async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
		const db = await this.ensureDb();
		const existing = await this.getMessages(sessionId);
		const startIndex = existing.length;

		return new Promise((resolve, reject) => {
			const tx = db.transaction(MESSAGES_STORE, "readwrite");
			const store = tx.objectStore(MESSAGES_STORE);

			messages.forEach((msg, idx) => {
				const stored: StoredMessage = {
					id: msg.id,
					sessionId,
					data: JSON.stringify(msg),
					index: startIndex + idx,
				};
				store.put(stored);
			});

			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	async updateSession(sessionId: string, updates: Partial<PersistedSession>): Promise<void> {
		const existing = await this.getSession(sessionId);
		if (!existing) return;

		const updated: PersistedSession = {
			...existing,
			...updates,
		};

		await this.saveSession(updated);
	}

	async getSessionCount(): Promise<number> {
		const db = await this.ensureDb();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(SESSIONS_STORE, "readonly");
			const store = tx.objectStore(SESSIONS_STORE);
			const request = store.count();

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async clearAll(): Promise<void> {
		const db = await this.ensureDb();

		return new Promise((resolve, reject) => {
			const tx = db.transaction([SESSIONS_STORE, MESSAGES_STORE], "readwrite");
			tx.objectStore(SESSIONS_STORE).clear();
			tx.objectStore(MESSAGES_STORE).clear();

			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}
}
