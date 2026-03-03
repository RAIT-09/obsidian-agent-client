import * as React from "react";

interface RawPatchViewProps {
	text: string;
	autoCollapse?: boolean;
	collapseThreshold?: number;
}

export function RawPatchView({
	text,
	autoCollapse,
	collapseThreshold = 10,
}: RawPatchViewProps) {
	const lines = text.split("\n");
	const shouldCollapse = autoCollapse && lines.length > collapseThreshold;
	const [isCollapsed, setIsCollapsed] = React.useState(shouldCollapse ?? false);
	const visibleLines = isCollapsed ? lines.slice(0, collapseThreshold) : lines;
	const remainingLines = lines.length - collapseThreshold;

	return (
		<div className="obsius-tool-call-diff">
			<div className="obsius-tool-call-diff-content">
				{visibleLines.map((line, idx) => {
					if (line.startsWith("@@")) {
						return (
							<div key={idx} className="obsius-diff-hunk-header">
								{line}
							</div>
						);
					}

					const isFileHeader =
						line.startsWith("---") || line.startsWith("+++");
					const isAdded = !isFileHeader && line.startsWith("+");
					const isRemoved = !isFileHeader && line.startsWith("-");

					let lineClass = "obsius-diff-line";
					let marker = " ";
					let content = line;

					if (isAdded) {
						lineClass += " obsius-diff-line-added";
						marker = "+";
						content = line.substring(1);
					} else if (isRemoved) {
						lineClass += " obsius-diff-line-removed";
						marker = "-";
						content = line.substring(1);
					} else {
						lineClass += " obsius-diff-line-context";
						if (line.startsWith(" ")) content = line.substring(1);
					}

					return (
						<div key={idx} className={lineClass}>
							<span className="obsius-diff-line-marker">{marker}</span>
							<span className="obsius-diff-line-content">{content}</span>
						</div>
					);
				})}
			</div>
			{shouldCollapse && (
				<div
					className="obsius-diff-expand-bar"
					onClick={() => setIsCollapsed(!isCollapsed)}
				>
					<span className="obsius-diff-expand-text">
						{isCollapsed ? `${remainingLines} more lines` : "Collapse"}
					</span>
					<span className="obsius-diff-expand-icon">
						{isCollapsed ? "▶" : "▲"}
					</span>
				</div>
			)}
		</div>
	);
}
