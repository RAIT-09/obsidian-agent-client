import * as React from "react";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import type { ToolCallContent } from "../types/chat";
import { DiffRenderer } from "./DiffRenderer";
import { TerminalBlock } from "./TerminalBlock";
import { ToolResultContent } from "./ToolResultContent";

interface ToolCallContentViewProps {
	content?: ToolCallContent[];
	rawOutput?: unknown;
	plugin: AgentClientPlugin;
	terminalClient?: AcpClient | null;
	/**
	 * Skip image blocks. The transcript renders them beside the collapsed
	 * row instead, so they stay visible without expanding the tool call.
	 */
	omitImages?: boolean;
}

/**
 * Render the body of a tool call: its content collection plus the raw-output
 * fallback. Shared by the transcript and the permission dialog so both show
 * the same thing.
 */
export function ToolCallContentView({
	content,
	rawOutput,
	plugin,
	terminalClient,
	omitImages = false,
}: ToolCallContentViewProps) {
	const items = content ?? [];

	return (
		<>
			{items.map((item, index) => {
				if (item.type === "content") {
					if (omitImages && item.content.type === "image") return null;
					return <ToolResultContent key={index} content={item.content} />;
				}
				if (item.type === "terminal") {
					return (
						<TerminalBlock
							key={index}
							terminalId={item.terminalId}
							terminalClient={terminalClient || null}
						/>
					);
				}
				if (item.type === "diff") {
					return (
						<DiffRenderer
							key={index}
							diff={item}
							plugin={plugin}
							autoCollapse={
								plugin.settings.displaySettings.autoCollapseDiffs
							}
							collapseThreshold={
								plugin.settings.displaySettings.diffCollapseThreshold
							}
						/>
					);
				}
				return null;
			})}

			{rawOutput !== undefined && items.length === 0 && (
				<details className="agent-client-tool-result-raw">
					<summary>Raw output</summary>
					<pre>
						{typeof rawOutput === "string"
							? rawOutput
							: JSON.stringify(rawOutput, null, 2)}
					</pre>
				</details>
			)}
		</>
	);
}
