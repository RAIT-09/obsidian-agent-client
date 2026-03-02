import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../src/domain/models/chat-message";
import { ChatMessages } from "../src/components/chat/ChatMessages";

interface MockMessageRendererProps {
	message: { id: string };
	activeSendingToolCallTarget?: { messageId: string; contentIndex: number } | null;
}

const mockMessageRenderer = vi.fn(
	({ message }: MockMessageRendererProps) => (
		<div data-testid={`message-${message.id}`} />
	),
);

vi.mock("../src/components/chat/MessageRenderer", () => ({
	MessageRenderer: (props: MockMessageRendererProps) => mockMessageRenderer(props),
}));

const mockPlugin = {} as Parameters<typeof ChatMessages>[0]["plugin"];

const mockView = {
	registerDomEvent: () => undefined,
} as unknown as Parameters<typeof ChatMessages>[0]["view"];

function createAssistantMessage(content: ChatMessage["content"]): ChatMessage {
	return {
		id: "assistant-1",
		role: "assistant",
		content,
		timestamp: new Date("2026-03-03T00:00:00.000Z"),
	};
}

describe("ChatMessages inline tool spinner targeting", () => {
	beforeEach(() => {
		mockMessageRenderer.mockClear();
	});

	it("targets the latest running non-file-edit tool call", () => {
		const messages = [
			createAssistantMessage([
				{
					type: "tool_call",
					toolCallId: "tool-1",
					title: "Read",
					kind: "read",
					status: "in_progress",
				},
			]),
		];

		const { container } = render(
			<ChatMessages
				messages={messages}
				isSending={true}
				isSessionReady={true}
				isRestoringSession={false}
				agentLabel="Agent"
				plugin={mockPlugin}
				view={mockView}
			/>,
		);

		const lastCallProps = mockMessageRenderer.mock.calls.at(-1)?.[0];
		expect(lastCallProps?.activeSendingToolCallTarget).toMatchObject({
			messageId: "assistant-1",
			contentIndex: 0,
		});
		expect(container.querySelector(".ac-loading")).toBeNull();
	});

	it("hides spinner for file-edit tool calls", () => {
		const messages = [
			createAssistantMessage([
				{
					type: "tool_call",
					toolCallId: "tool-1",
					title: "write",
					kind: "edit",
					status: "in_progress",
				},
			]),
		];

		const { container } = render(
			<ChatMessages
				messages={messages}
				isSending={true}
				isSessionReady={true}
				isRestoringSession={false}
				agentLabel="Agent"
				plugin={mockPlugin}
				view={mockView}
			/>,
		);

		const lastCallProps = mockMessageRenderer.mock.calls.at(-1)?.[0];
		expect(lastCallProps?.activeSendingToolCallTarget ?? null).toBeNull();
		expect(container.querySelector(".ac-loading")).toBeNull();
	});

	it("falls back to trailing spinner when no running tool call remains", () => {
		const messages = [
			createAssistantMessage([
				{
					type: "tool_call",
					toolCallId: "tool-1",
					title: "Read",
					kind: "read",
					status: "completed",
				},
				{
					type: "agent_thought",
					text: "Thinking about next action",
				},
			]),
		];

		const { container } = render(
			<ChatMessages
				messages={messages}
				isSending={true}
				isSessionReady={true}
				isRestoringSession={false}
				agentLabel="Agent"
				plugin={mockPlugin}
				view={mockView}
			/>,
		);

		const lastCallProps = mockMessageRenderer.mock.calls.at(-1)?.[0];
		expect(lastCallProps?.activeSendingToolCallTarget ?? null).toBeNull();
		expect(container.querySelector(".ac-loading")).not.toBeNull();
	});
});
