import { describe, it, expect } from "vitest";
import { AcpTypeConverter } from "../src/acp/type-converter";

// Types derived from the converter: SDK imports stay inside src/acp/
type InitializeResponse = Parameters<
	typeof AcpTypeConverter.toInitializeResult
>[0];
type SessionCapabilities = NonNullable<
	InitializeResponse["agentCapabilities"]
>["sessionCapabilities"];

const init = (
	sessionCapabilities?: SessionCapabilities,
): InitializeResponse => ({
	protocolVersion: 1,
	agentCapabilities: { sessionCapabilities },
});

const sessionCaps = (sessionCapabilities?: SessionCapabilities) =>
	AcpTypeConverter.toInitializeResult(init(sessionCapabilities))
		.agentCapabilities?.sessionCapabilities;

describe("AcpTypeConverter.toAppendedSystemPrompt", () => {
	it("appends each instruction as a text block", () => {
		expect(AcpTypeConverter.toAppendedSystemPrompt(["a", "b"])).toEqual({
			mode: "append",
			content: [
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			],
		});
	});

	it("is undefined without instructions, since content must not be empty", () => {
		expect(AcpTypeConverter.toAppendedSystemPrompt([])).toBeUndefined();
	});
});

describe("AcpTypeConverter.toInitializeResult sessionCapabilities", () => {
	it("keeps session/delete support", () => {
		expect(sessionCaps({ delete: {}, list: {} })).toEqual({
			resume: undefined,
			fork: undefined,
			list: {},
			delete: {},
		});
	});

	it("maps an absent or null delete capability to undefined", () => {
		expect(sessionCaps({ list: {} })?.delete).toBeUndefined();
		expect(sessionCaps({ list: {}, delete: null })?.delete).toBeUndefined();
	});

	it("has no session capabilities when the agent reports none", () => {
		expect(sessionCaps(undefined)).toBeUndefined();
	});
});
