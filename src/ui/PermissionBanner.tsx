import { getLogger } from "../utils/logger";
import type { PermissionOption } from "../types/chat";
import { LucideIcon } from "./shared/IconButton";

/**
 * Maps permission option kind to its Lucide icon name.
 * Kind semantics are conveyed by icon shape + color (the button
 * background stays neutral for theme compatibility).
 */
const KIND_ICONS: Record<PermissionOption["kind"], string> = {
	allow_always: "check-check",
	allow_once: "check",
	reject_once: "x",
	reject_always: "ban",
};

interface PermissionBannerProps {
	permissionRequest: {
		requestId: string;
		options: PermissionOption[];
		selectedOptionId?: string;
		isCancelled?: boolean;
		isActive?: boolean;
	};
	/** Whether to show kind icons (follows displaySettings.showEmojis) */
	showEmojis: boolean;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
	onOptionSelected?: (optionId: string) => void;
}

export function PermissionBanner({
	permissionRequest,
	showEmojis,
	onApprovePermission,
	onOptionSelected,
}: PermissionBannerProps) {
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
					className={`agent-client-permission-option agent-client-permission-kind-${option.kind}`}
					title={option.name}
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
					{showEmojis && (
						<LucideIcon
							name={KIND_ICONS[option.kind]}
							className="agent-client-permission-option-icon"
						/>
					)}
					<span className="agent-client-permission-option-label">
						{option.name}
					</span>
				</button>
			))}
		</div>
	);
}
