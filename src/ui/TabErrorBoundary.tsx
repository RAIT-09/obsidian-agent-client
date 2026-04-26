import * as React from "react";

interface Props {
	tabId: string;
	onError?: (tabId: string) => void;
	children: React.ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

/**
 * Error boundary that wraps each tab's ChatContextProvider + ChatPanel.
 * Catches render errors in a single tab without crashing the entire view.
 */
export class TabErrorBoundary extends React.Component<Props, State> {
	state: State = { hasError: false, error: null };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		console.error(
			`[Agent Client] Tab ${this.props.tabId} crashed:`,
			error,
			info.componentStack,
		);
		this.props.onError?.(this.props.tabId);
	}

	private handleRetry = () => {
		this.setState({ hasError: false, error: null });
	};

	render() {
		if (this.state.hasError) {
			return (
				<div className="agent-client-tab-error">
					<div className="agent-client-tab-error-icon">⚠</div>
					<div className="agent-client-tab-error-title">
						This tab encountered an error
					</div>
					<div className="agent-client-tab-error-message">
						{this.state.error?.message ?? "Unknown error"}
					</div>
					<button
						className="agent-client-tab-error-retry"
						onClick={this.handleRetry}
					>
						Retry
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}
