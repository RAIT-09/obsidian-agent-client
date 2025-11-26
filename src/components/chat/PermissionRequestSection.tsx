import * as React from "react";
const { useMemo } = React;
import type AgentClientPlugin from "../../plugin";
import { Logger } from "../../shared/logger";
import * as acp from "@agentclientprotocol/sdk";

interface PermissionRequestSectionProps {
	permissionRequest: {
		requestId: string;
		options: acp.PermissionOption[];
		selectedOptionId?: string;
		isCancelled?: boolean;
		isActive?: boolean;
	};
	toolCallId: string;
	plugin: AgentClientPlugin;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
	onOptionSelected?: (optionId: string) => void;
}

export function PermissionRequestSection({
	permissionRequest,
	toolCallId,
	plugin,
	onApprovePermission,
	onOptionSelected,
}: PermissionRequestSectionProps) {
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	const isSelected = permissionRequest.selectedOptionId !== undefined;
	const isCancelled = permissionRequest.isCancelled === true;
	const isActive = permissionRequest.isActive !== false;
	const selectedOption = permissionRequest.options.find(
		(opt) => opt.optionId === permissionRequest.selectedOptionId,
	);

	return (
		<div className="message-permission-request">
			{isActive && !isSelected && !isCancelled && (
				<div className="message-permission-request-options">
					{permissionRequest.options.map((option) => (
						<button
							key={option.optionId}
							className={`permission-option ${option.kind ? `permission-kind-${option.kind}` : ""}`}
							onClick={() => {
								// Update local UI state immediately for feedback
								if (onOptionSelected) {
									onOptionSelected(option.optionId);
								}

								if (onApprovePermission) {
									// Send response to agent via callback
									void onApprovePermission(
										permissionRequest.requestId,
										option.optionId,
									);
								} else {
									logger.warn(
										"Cannot handle permission response: missing onApprovePermission callback",
									);
								}
							}}
						>
							{option.name}
						</button>
					))}
				</div>
			)}
			{isSelected && selectedOption && (
				<div className="message-permission-request-result selected">
					✓ Selected: {selectedOption.name}
				</div>
			)}
			{isCancelled && (
				<div className="message-permission-request-result cancelled">
					⚠ Cancelled: Permission request was cancelled
				</div>
			)}
		</div>
	);
}
