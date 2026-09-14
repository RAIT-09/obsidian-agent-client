import type { PlanEntry } from "../types/chat";
import type { PlanSummary } from "../services/message-state";
import { LucideIcon } from "./shared/IconButton";
import { useCollapsibleToggle } from "../hooks/useCollapsibleToggle";

interface PlanStripProps {
	entries: PlanEntry[];
	summary: PlanSummary;
	expanded: boolean;
	onToggle: () => void;
	showEmojis: boolean;
}

const STATUS_ICONS: Record<PlanEntry["status"], string> = {
	completed: "check",
	in_progress: "loader",
	pending: "circle",
};

/**
 * Ambient view of the agent's latest plan, shown under the header in
 * every variant. Collapsed it is one line — progress plus the entry
 * being worked on; expanded it lists every entry. The transcript does
 * not render plans (the data still flows through messages, so session
 * restore and Markdown export keep working unchanged).
 */
export function PlanStrip({
	entries,
	summary,
	expanded,
	onToggle,
	showEmojis,
}: PlanStripProps) {
	const toggleProps = useCollapsibleToggle(expanded, onToggle);

	return (
		<div className="agent-client-plan-strip">
			<div className="agent-client-plan-strip-summary" {...toggleProps}>
				{showEmojis && (
					<LucideIcon
						name="list-checks"
						className="agent-client-plan-strip-icon"
					/>
				)}
				<span className="agent-client-plan-strip-count">
					Plan {summary.completed}/{summary.total}
				</span>
				{summary.current && (
					<span className="agent-client-plan-strip-current">
						· {summary.current.content}
					</span>
				)}
				<LucideIcon
					name={expanded ? "chevron-down" : "chevron-right"}
					className="agent-client-plan-strip-chevron"
				/>
			</div>
			{expanded && (
				<div className="agent-client-plan-strip-entries">
					{entries.map((entry, idx) => (
						<div
							key={idx}
							className={`agent-client-plan-strip-entry agent-client-plan-status-${entry.status}`}
						>
							{showEmojis && (
								<span
									className={`agent-client-plan-strip-entry-icon agent-client-status-${entry.status}`}
								>
									<LucideIcon
										name={STATUS_ICONS[entry.status]}
									/>
								</span>
							)}
							<span className="agent-client-plan-strip-entry-text">
								{entry.content}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
