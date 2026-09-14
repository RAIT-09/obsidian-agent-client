import * as React from "react";
import type { ToolResultContentBlock } from "../types/chat";

interface ToolResultContentProps {
	content: ToolResultContentBlock;
}

/** Render ACP standard tool result content inside the existing tool block. */
export function ToolResultContent({ content }: ToolResultContentProps) {
	switch (content.type) {
		case "text":
			return (
				<pre className="agent-client-tool-result-text">
					{content.text}
				</pre>
			);
		case "image":
			return (
				<img
					className="agent-client-tool-result-image"
					src={`data:${content.mimeType};base64,${content.data}`}
					alt="Tool result"
				/>
			);
		case "audio":
			return (
				<audio
					className="agent-client-tool-result-audio"
					controls
					src={`data:${content.mimeType};base64,${content.data}`}
					aria-label="Tool result audio"
				/>
			);
		case "resource_link":
			return (
				// The URI comes from the agent. `target="_blank"` is what routes
				// the click through Obsidian's external-link handling, which
				// confirms unknown schemes with the user and leaves
				// `javascript:`/`data:` URIs inert; without it the href would
				// navigate in place. Keep it even if a refactor suggests
				// otherwise.
				<a
					className="agent-client-tool-result-resource"
					href={content.uri}
					target="_blank"
					rel="noreferrer"
					title={content.uri}
				>
					<strong>{content.title || content.name}</strong>
					{content.description && (
						<small>{content.description}</small>
					)}
				</a>
			);
		case "resource": {
			const { resource } = content;
			return (
				<details className="agent-client-tool-result-resource-embedded">
					<summary>{resource.uri}</summary>
					{"text" in resource ? (
						<pre>{resource.text}</pre>
					) : (
						<p>
							Binary resource ·{" "}
							{resource.mimeType || "unknown type"}
						</p>
					)}
				</details>
			);
		}
	}
}
