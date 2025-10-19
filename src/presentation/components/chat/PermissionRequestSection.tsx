import * as React from "react";
const { useMemo } = React;
import type { IAcpClient } from "../../../adapters/acp/acp.adapter";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import type { HandlePermissionUseCase } from "../../../core/use-cases/handle-permission.use-case";
import { Logger } from "../../../shared/logger";
import * as acp from "@agentclientprotocol/sdk";

interface PermissionRequestSectionProps {
	permissionRequest: {
		requestId: string;
		options: acp.PermissionOption[];
		selectedOptionId?: string;
		isCancelled?: boolean;
	};
	toolCallId: string;
	acpClient?: IAcpClient;
	handlePermissionUseCase?: HandlePermissionUseCase;
	plugin: AgentClientPlugin;
	onOptionSelected?: (optionId: string) => void;
}

export function PermissionRequestSection({
	permissionRequest,
	toolCallId,
	acpClient,
	handlePermissionUseCase,
	plugin,
	onOptionSelected,
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
							onClick={async () => {
								// Update local UI state immediately for feedback
								if (onOptionSelected) {
									onOptionSelected(option.optionId);
								}

								if (handlePermissionUseCase) {
									// Send response to agent via Use Case
									const result =
										await handlePermissionUseCase.approvePermission(
											{
												requestId:
													permissionRequest.requestId,
												optionId: option.optionId,
											},
										);

									if (!result.success) {
										logger.error(
											"Failed to approve permission:",
											result.error,
										);
									}
								} else {
									logger.warn(
										"Cannot handle permission response: missing handlePermissionUseCase",
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
