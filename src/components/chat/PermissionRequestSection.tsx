import * as React from "react";
const { useMemo } = React;
import type { IAcpClient } from "../../types/acp-types";
import type AgentClientPlugin from "../../main";
import { Logger } from "../../utils/logger";
import * as acp from "@zed-industries/agent-client-protocol";

interface PermissionRequestSectionProps {
	permissionRequest: {
		requestId: string;
		options: acp.PermissionOption[];
		selectedOptionId?: string;
		isCancelled?: boolean;
	};
	toolCallId: string;
	acpClient?: IAcpClient;
	plugin: AgentClientPlugin;
	onPermissionSelected?: (requestId: string, optionId: string) => void;
}

export function PermissionRequestSection({
	permissionRequest,
	toolCallId,
	acpClient,
	plugin,
	onPermissionSelected,
}: PermissionRequestSectionProps) {
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	const isSelected = permissionRequest.selectedOptionId !== undefined;
	const isCancelled = permissionRequest.isCancelled === true;
	const selectedOption = permissionRequest.options.find(
		(opt) => opt.optionId === permissionRequest.selectedOptionId,
	);

	return (
		<div className="message-permission-request">
			{!isSelected && !isCancelled && (
				<div className="message-permission-request-options">
					{permissionRequest.options.map((option) => (
						<button
							key={option.optionId}
							className={`permission-option ${option.kind ? `permission-kind-${option.kind}` : ""}`}
							onClick={() => {
								if (acpClient) {
									// Call the callback if provided
									if (onPermissionSelected) {
										onPermissionSelected(
											permissionRequest.requestId,
											option.optionId,
										);
									}

									// Send response to agent
									acpClient.handlePermissionResponse(
										permissionRequest.requestId,
										option.optionId,
									);
								} else {
									logger.warn(
										"Cannot handle permission response: missing acpClient",
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
