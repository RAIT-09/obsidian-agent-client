import * as React from "react";
import type AgentClientPlugin from "../plugin";
import type { ActivePermission } from "../types/chat";
import { PermissionBanner } from "./PermissionBanner";
import { ToolCallContentView } from "./ToolCallContentView";
import { LucideIcon } from "./shared/IconButton";

const { useState, useEffect, useMemo } = React;

interface PermissionDialogProps {
	permission: ActivePermission;
	/** Requests waiting behind this one; shown so the queue is not a surprise. */
	queuedCount: number;
	plugin: AgentClientPlugin;
	showEmojis: boolean;
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

const KIND_ICONS: Record<string, string> = {
	read: "book-open",
	edit: "pencil",
	delete: "trash",
	move: "folder-open",
	search: "search",
	execute: "square-terminal",
	think: "message-circle-more",
	fetch: "globe",
	switch_mode: "arrow-left-right",
};

/**
 * Permission request shown above the input, where the buttons are always in
 * reach. It doubles as the review surface: the command about to run or the
 * edit about to be made is rendered here. The tool call itself stays in the
 * transcript throughout — this dialog is the place to decide, not the record.
 */
export function PermissionDialog({
	permission,
	queuedCount,
	plugin,
	showEmojis,
	onApprovePermission,
}: PermissionDialogProps) {
	// Mirror the chosen option immediately, before the agent's update lands.
	const [selectedOptionId, setSelectedOptionId] = useState<
		string | undefined
	>(undefined);

	// A new request reuses this component; clear the previous selection.
	useEffect(() => {
		setSelectedOptionId(undefined);
	}, [permission.requestId]);

	const command =
		typeof permission.rawInput?.command === "string"
			? permission.rawInput.command
			: null;
	const args = Array.isArray(permission.rawInput?.args)
		? (permission.rawInput.args as string[]).join(" ")
		: "";

	// Same thumbnail strip as the transcript rows: images everywhere are
	// 120px thumbs, full-size at 384px would dominate a mixed review.
	const images = useMemo(
		() =>
			(permission.content ?? []).flatMap((item) =>
				item.type === "content" && item.content.type === "image"
					? [item.content]
					: [],
			),
		[permission.content],
	);

	return (
		<div className="agent-client-permission-dialog">
			<div className="agent-client-permission-dialog-header">
				{showEmojis && (
					<LucideIcon
						name={
							(permission.kind && KIND_ICONS[permission.kind]) ||
							"hammer"
						}
						className="agent-client-permission-dialog-icon"
					/>
				)}
				<span className="agent-client-permission-dialog-title">
					{permission.title || "Permission required"}
				</span>
				{queuedCount > 0 && (
					<span className="agent-client-permission-dialog-queue">
						+{queuedCount}
					</span>
				)}
			</div>

			<div className="agent-client-permission-dialog-review">
				{command && (
					<div className="agent-client-message-tool-call-command">
						<code>
							{command}
							{args && ` ${args}`}
						</code>
					</div>
				)}
				{images.length > 0 && (
					<div className="agent-client-tool-result-images-strip">
						{images.map((image, index) => (
							<img
								key={index}
								className="agent-client-tool-result-image-thumbnail"
								src={`data:${image.mimeType};base64,${image.data}`}
								alt="Tool result"
							/>
						))}
					</div>
				)}
				<ToolCallContentView
					content={permission.content}
					plugin={plugin}
					terminalClient={null}
					omitImages
				/>
			</div>

			<PermissionBanner
				permissionRequest={{
					requestId: permission.requestId,
					options: permission.options,
					selectedOptionId,
				}}
				showEmojis={showEmojis}
				onApprovePermission={onApprovePermission}
				onOptionSelected={setSelectedOptionId}
			/>
		</div>
	);
}
