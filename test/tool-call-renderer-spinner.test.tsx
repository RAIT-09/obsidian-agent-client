import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolCallRenderer } from "../src/components/chat/ToolCallRenderer";

vi.mock("../src/components/chat/ObsidianIcon", () => ({
	ObsidianIcon: ({
		name,
		className,
	}: {
		name: string;
		className?: string;
		size?: number;
	}) => <span data-icon={name} className={className} aria-hidden="true" />,
}));

const mockPlugin = {
	app: {
		vault: {
			adapter: {},
		},
		workspace: {
			getLeavesOfType: () => [],
			setActiveLeaf: () => undefined,
			openLinkText: () => Promise.resolve(),
		},
	},
	settings: {
		displaySettings: {
			autoCollapseDiffs: false,
			diffCollapseThreshold: 10,
		},
	},
} as unknown as Parameters<typeof ToolCallRenderer>[0]["plugin"];

function renderToolCall(showLiveIndicator: boolean) {
	return render(
		<ToolCallRenderer
			content={{
				type: "tool_call",
				toolCallId: "tool-1",
				title: "Bash",
				kind: "execute",
				status: "in_progress",
				rawInput: {
					command: "echo test",
				},
			}}
			plugin={mockPlugin}
			showLiveIndicator={showLiveIndicator}
		/>,
	);
}

describe("ToolCallRenderer live spinner placement", () => {
	it("replaces the tool icon with the spinner when live indicator is active", () => {
		const { container } = renderToolCall(true);

		const header = container.querySelector(".ac-collapsible__header");
		expect(header).not.toBeNull();

		const spinnerSlot = header?.querySelector(".ac-tool-icon--spinner");
		expect(spinnerSlot).not.toBeNull();
		expect(
			spinnerSlot?.querySelector(".ac-loading__spinner--inline"),
		).not.toBeNull();

		expect(header?.querySelector("[data-icon='terminal']")).toBeNull();
	});

	it("shows tool icon (no spinner) when live indicator is off", () => {
		const { container } = renderToolCall(false);

		expect(container.querySelector(".ac-tool-icon--spinner")).toBeNull();
		expect(
			container.querySelector(".ac-loading__spinner--inline"),
		).toBeNull();

		expect(container.querySelector(".ac-tool-icon[data-icon]")).not.toBeNull();
		expect(container.querySelector(".ac-tool-status [data-icon='loader-2']")).not.toBeNull();
	});
});
