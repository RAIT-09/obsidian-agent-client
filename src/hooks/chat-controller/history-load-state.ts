import { useCallback, useState } from "react";
import type { SessionModeState, SessionModelState } from "../../domain/models/chat-session";
import type { Logger } from "../../shared/logger";

interface UseHistoryLoadStateOptions {
	logger: Logger;
	updateSessionFromLoad: (
		sessionId: string,
		modes?: SessionModeState,
		models?: SessionModelState,
	) => void;
	clearMessages: () => void;
}

export function useHistoryLoadState({
	logger,
	updateSessionFromLoad,
	clearMessages,
}: UseHistoryLoadStateOptions) {
	const [isLoadingSessionHistory, setIsLoadingSessionHistory] = useState(false);

	const handleSessionLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
		) => {
			logger.log(`[useChatController] Session loaded/resumed/forked: ${sessionId}`, {
				modes,
				models,
			});
			updateSessionFromLoad(sessionId, modes, models);
		},
		[logger, updateSessionFromLoad],
	);

	const handleLoadStart = useCallback(() => {
		logger.log("[useChatController] session/load started, ignoring history replay");
		setIsLoadingSessionHistory(true);
		clearMessages();
	}, [logger, clearMessages]);

	const handleLoadEnd = useCallback(() => {
		logger.log(
			"[useChatController] session/load ended, resuming normal processing",
		);
		setIsLoadingSessionHistory(false);
	}, [logger]);

	return {
		isLoadingSessionHistory,
		handleSessionLoad,
		handleLoadStart,
		handleLoadEnd,
	};
}
