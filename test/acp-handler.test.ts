import { describe, expect, it } from "vitest";
import { getModelIdFromMeta } from "../src/acp/acp-handler";

describe("getModelIdFromMeta", () => {
	it("returns a trimmed modelId string from ACP metadata", () => {
		expect(getModelIdFromMeta({ modelId: "  claude-sonnet-4  " })).toBe(
			"claude-sonnet-4",
		);
	});

	it("ignores absent, blank, and non-string modelId values", () => {
		expect(getModelIdFromMeta(undefined)).toBeUndefined();
		expect(getModelIdFromMeta({ modelId: "   " })).toBeUndefined();
		expect(getModelIdFromMeta({ modelId: 42 })).toBeUndefined();
	});
});
