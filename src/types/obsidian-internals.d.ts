export {};

/**
 * Type augmentation for unofficial Obsidian APIs.
 *
 * These methods exist at runtime but are not in the public type definitions.
 * Only add methods that are widely used by the plugin community and unlikely
 * to be removed without notice.
 */
declare module "obsidian" {
	interface Vault {
		getConfig(key: string): unknown;
	}
}
