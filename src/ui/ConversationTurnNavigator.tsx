import * as React from "react";
import type { ConversationNavigationItem } from "../services/conversation-navigation";

interface ConversationTurnNavigatorProps {
	items: ConversationNavigationItem[];
	activeIndex: number;
	onNavigate: (item: ConversationNavigationItem, index: number) => void;
	onWheel: (deltaY: number) => void;
}

export const ConversationTurnNavigator = React.memo(
	function ConversationTurnNavigator({
		items,
		activeIndex,
		onNavigate,
		onWheel,
	}: ConversationTurnNavigatorProps) {
		const [isInteracting, setIsInteracting] = React.useState(false);
		const collapseTimerRef = React.useRef<number | null>(null);
		const previewIdPrefix = React.useId();
		const navigatorRef = React.useRef<HTMLElement>(null);

		const activate = React.useCallback(() => {
			if (collapseTimerRef.current !== null) {
				window.clearTimeout(collapseTimerRef.current);
				collapseTimerRef.current = null;
			}
			setIsInteracting(true);
		}, []);

		const scheduleCollapse = React.useCallback(() => {
			if (collapseTimerRef.current !== null) {
				window.clearTimeout(collapseTimerRef.current);
			}
			collapseTimerRef.current = window.setTimeout(() => {
				setIsInteracting(false);
				collapseTimerRef.current = null;
			}, 160);
		}, []);

		React.useEffect(
			() => () => {
				if (collapseTimerRef.current !== null) {
					window.clearTimeout(collapseTimerRef.current);
				}
			},
			[],
		);

		React.useEffect(() => {
			const navigator = navigatorRef.current;
			if (!navigator) return;

			const handleWheel = (event: WheelEvent) => {
				event.preventDefault();
				const lineHeight =
					Number.parseFloat(
						window.getComputedStyle(navigator).lineHeight,
					) || 16;
				const pageHeight =
					navigator.parentElement?.clientHeight || window.innerHeight;
				const deltaY =
					event.deltaMode === WheelEvent.DOM_DELTA_LINE
						? event.deltaY * lineHeight
						: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
							? event.deltaY * pageHeight
							: event.deltaY;
				onWheel(deltaY);
			};

			navigator.addEventListener("wheel", handleWheel, {
				passive: false,
			});
			return () => navigator.removeEventListener("wheel", handleWheel);
		}, [onWheel]);

		return (
			<nav
				ref={navigatorRef}
				className={`agent-client-turn-navigator ${isInteracting ? "agent-client-is-interacting" : ""}`}
				aria-label="Conversation turns"
				onMouseLeave={scheduleCollapse}
				onFocus={activate}
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) {
						scheduleCollapse();
					}
				}}
			>
				{items.map((item, index) => {
					const previewId = `${previewIdPrefix}-turn-${index}`;
					return (
						<button
							key={item.id}
							type="button"
							className={`agent-client-turn-navigator-item ${index === activeIndex ? "agent-client-is-active" : ""}`}
							aria-current={
								index === activeIndex ? "step" : undefined
							}
							aria-describedby={previewId}
							aria-label={`Go to turn ${index + 1}: ${item.question}`}
							onClick={() => onNavigate(item, index)}
							onMouseEnter={activate}
						>
							<span
								className="agent-client-turn-navigator-line"
								aria-hidden="true"
							/>
							<span
								id={previewId}
								className="agent-client-turn-navigator-preview"
							>
								<span className="agent-client-turn-navigator-question">
									{item.question}
								</span>
								<span className="agent-client-turn-navigator-response">
									{item.response}
								</span>
							</span>
						</button>
					);
				})}
			</nav>
		);
	},
);
