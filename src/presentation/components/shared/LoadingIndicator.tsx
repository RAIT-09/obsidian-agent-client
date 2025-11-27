import * as React from "react";

interface LoadingIndicatorProps {
	label?: string;
	showLabel?: boolean;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
	label = "Thinking",
	showLabel = true,
}) => {
	return (
		<div className="loading-indicator" role="status" aria-label={label}>
			{showLabel && (
				<span className="loading-indicator-label" aria-hidden="true">
					{label}
				</span>
			)}
			<div className="loading-dots" aria-hidden="true">
				<span className="loading-dot" />
				<span className="loading-dot" />
				<span className="loading-dot" />
			</div>
			<span className="sr-only">{label}</span>
		</div>
	);
};
