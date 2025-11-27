import * as React from "react";
const { useMemo, useCallback } = React;
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
		isActive?: boolean;
	};
	toolCallId: string;
	acpClient?: IAcpClient;
	handlePermissionUseCase?: HandlePermissionUseCase;
	plugin: AgentClientPlugin;
	onOptionSelected?: (optionId: string) => void;
}

export const PermissionRequestSection = React.memo(
	function PermissionRequestSection({
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
		const isActive = permissionRequest.isActive !== false;
		const selectedOption = permissionRequest.options.find(
			(opt) => opt.optionId === permissionRequest.selectedOptionId,
		);

		const handleOptionClick = useCallback(
			async (optionId: string) => {
				// Update local UI state immediately for feedback
				if (onOptionSelected) {
					onOptionSelected(optionId);
				}

				if (handlePermissionUseCase) {
					// Send response to agent via Use Case
					const result =
						await handlePermissionUseCase.approvePermission({
							requestId: permissionRequest.requestId,
							optionId,
						});

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
			},
			[
				onOptionSelected,
				handlePermissionUseCase,
				permissionRequest.requestId,
				logger,
			],
		);

		return (
			<div
				className="message-permission-request"
				role="group"
				aria-label="Permission request"
			>
				{isActive && !isSelected && !isCancelled && (
					<div
						className="message-permission-request-options"
						role="group"
						aria-label="Permission options"
					>
						{permissionRequest.options.map((option) => (
							<button
								key={option.optionId}
								type="button"
								className={`permission-option ${option.kind ? `permission-kind-${option.kind}` : ""}`}
								onClick={() =>
									handleOptionClick(option.optionId)
								}
								aria-describedby={`permission-desc-${permissionRequest.requestId}`}
							>
								{option.name}
							</button>
						))}
					</div>
				)}
				{isSelected && selectedOption && (
					<div
						className="message-permission-request-result selected"
						role="status"
						aria-live="polite"
					>
						<span aria-hidden="true">&#10003;</span>
						<span className="sr-only">
							Approved:
						</span> Selected: {selectedOption.name}
					</div>
				)}
				{isCancelled && (
					<div
						className="message-permission-request-result cancelled"
						role="alert"
					>
						<span aria-hidden="true">&#9888;</span>
						<span className="sr-only">Warning:</span> Cancelled:
						Permission request was cancelled
					</div>
				)}
			</div>
		);
	},
);
