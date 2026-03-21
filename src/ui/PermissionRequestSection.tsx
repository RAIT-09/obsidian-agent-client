import type AgentClientPlugin from "../plugin";
import { getLogger } from "../utils/logger";
import type { PermissionOption } from "../types/chat";

interface PermissionRequestSectionProps {
	permissionRequest: {
		requestId: string;
		options: PermissionOption[];
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

	const isSelected = permissionRequest.selectedOptionId !== undefined;
	const isCancelled = permissionRequest.isCancelled === true;
	const isActive = permissionRequest.isActive !== false;

	if (!isActive || isSelected || isCancelled) return null;

	return (
		<div className="agent-client-message-permission-request">
			{permissionRequest.options.map((option) => (
				<button
					key={option.optionId}
					className={`agent-client-permission-option ${option.kind ? `agent-client-permission-kind-${option.kind}` : ""}`}
					onClick={() => {
						if (onOptionSelected) {
							onOptionSelected(option.optionId);
						}

						if (onApprovePermission) {
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
	);
}
