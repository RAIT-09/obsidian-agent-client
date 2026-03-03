export {
	discoverModifiedFiles,
	getLastAssistantMessage,
	toVaultRelativePath,
} from "./session-file-restoration";
export type {
	DiscoveredFile,
	FileChange,
	SessionChangeSet,
} from "./session-file-restoration";
export { SnapshotManager } from "./snapshot-manager";
export type { FileIo, RevertResult } from "./snapshot-manager";
