import type AgentClientPlugin from "../../plugin";
import { getLogger } from "../../shared/logger";
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
	onApprovePermission?: (requestId: string, optionId: string) => Promise<void>;
	onOptionSelected?: (optionId: string) => void;
}

export function PermissionRequestSection({
	permissionRequest,
	toolCallId,
	plugin,
	onApprovePermission,
	onOptionSelected,
}: PermissionRequestSectionProps) {
	const logger = getLogger();
	const getOptionLabel = (option: acp.PermissionOption): string => {
		if (option.kind === "allow_once" || option.kind === "allow_always") {
			return "Allow";
		}
		if (option.kind === "reject_once" || option.kind === "reject_always") {
			return "Deny";
		}
		return option.name;
	};

	const isSelected = permissionRequest.selectedOptionId !== undefined;
	const isCancelled = permissionRequest.isCancelled === true;
	const isActive = permissionRequest.isActive !== false;
	const hasAllowOnce = permissionRequest.options.some(
		(option) => option.kind === "allow_once",
	);
	const hasRejectOnce = permissionRequest.options.some(
		(option) => option.kind === "reject_once",
	);
	const visibleOptions = permissionRequest.options.filter((option) => {
		if (option.kind === "allow_always" && hasAllowOnce) {
			return false;
		}
		if (option.kind === "reject_always" && hasRejectOnce) {
			return false;
		}
		return true;
	});
	const selectedOption = permissionRequest.options.find(
		(opt) => opt.optionId === permissionRequest.selectedOptionId,
	);
	const selectedKind = selectedOption?.kind;
	const selectedResultLabel =
		selectedKind === "allow_once" || selectedKind === "allow_always"
			? "Allowed"
			: selectedKind === "reject_once" || selectedKind === "reject_always"
				? "Denied"
				: selectedOption
					? getOptionLabel(selectedOption)
					: "";
	const selectedResultClass =
		selectedKind === "allow_once" || selectedKind === "allow_always"
			? "obsius-result-allow"
			: selectedKind === "reject_once" || selectedKind === "reject_always"
				? "obsius-result-deny"
				: "";

	return (
		<div className="obsius-message-permission-request">
			{isActive && !isSelected && !isCancelled && (
				<div className="obsius-message-permission-request-options">
					{visibleOptions.map((option) => (
						<button
							key={option.optionId}
							className={`obsius-permission-option ${option.kind ? `obsius-permission-kind-${option.kind}` : ""}`}
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
							{getOptionLabel(option)}
						</button>
					))}
				</div>
			)}
			{isSelected && selectedOption && (
				<div
					className={`obsius-message-permission-request-result obsius-selected ${selectedResultClass}`}
				>
					{selectedResultLabel}
				</div>
			)}
			{isCancelled && (
				<div className="obsius-message-permission-request-result obsius-cancelled">
					Cancelled: Permission request was cancelled
				</div>
			)}
		</div>
	);
}
