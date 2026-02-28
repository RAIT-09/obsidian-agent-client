import type AgentClientPlugin from "../../plugin";
import { getLogger } from "../../shared/logger";
import { getUiLanguage, t } from "../../shared/i18n";
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
	const logger = getLogger();
	const language = getUiLanguage(plugin.app);
	const showEmojis = plugin.settings.displaySettings.showEmojis;

	const isSelected = permissionRequest.selectedOptionId !== undefined;
	const isCancelled = permissionRequest.isCancelled === true;
	const isActive = permissionRequest.isActive !== false;
	const selectedOption = permissionRequest.options.find(
		(opt) => opt.optionId === permissionRequest.selectedOptionId,
	);

	return (
		<div className="agent-client-message-permission-request">
			{isActive && !isSelected && !isCancelled && (
				<div className="agent-client-message-permission-request-options">
					{permissionRequest.options.map((option) => (
						<button
							key={option.optionId}
							className={`agent-client-permission-option ${option.kind ? `agent-client-permission-kind-${option.kind}` : ""}`}
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
				<div className="agent-client-message-permission-request-result agent-client-selected">
					{showEmojis && "✓ "}
					{t(language, "permissionSelected", {
						option: selectedOption.name,
					})}
				</div>
			)}
			{isCancelled && (
				<div className="agent-client-message-permission-request-result agent-client-cancelled">
					{showEmojis && "⚠ "}
					{t(language, "permissionRequestCancelled")}
				</div>
			)}
		</div>
	);
}
