import { useMemo, useEffect } from "react";
import type { SessionModelState } from "../domain/models/chat-session";
import type { ISettingsAccess } from "../domain/ports/settings-access.port";
import { getLogger } from "../shared/logger";

interface UseModelFilteringOptions {
	sessionModels: SessionModelState | undefined;
	agentId: string;
	sessionId: string | null;
	candidateModels: Record<string, string[]> | undefined;
	settingsAccess: ISettingsAccess;
	setModel: (modelId: string) => Promise<void>;
}

export function useModelFiltering(
	options: UseModelFilteringOptions,
): SessionModelState | undefined {
	const {
		sessionModels,
		agentId,
		sessionId,
		candidateModels,
		settingsAccess,
		setModel,
	} = options;
	const logger = getLogger();

	const filteredModels = useMemo(() => {
		if (!sessionModels) return undefined;

		const candidates = candidateModels?.[agentId];
		if (!candidates || candidates.length === 0) {
			return sessionModels;
		}

		const available = sessionModels.availableModels;
		const validCandidates = candidates.filter((id) =>
			available.some((m) => m.modelId === id),
		);

		if (validCandidates.length === 0) {
			return sessionModels;
		}

		const modelById = new Map(
			available.map((model) => [model.modelId, model] as const),
		);
		const filtered = validCandidates
			.map((modelId) => modelById.get(modelId))
			.filter((model): model is (typeof available)[number] => model !== undefined);

		const currentInFiltered = filtered.some(
			(m) => m.modelId === sessionModels.currentModelId,
		);
		const effectiveModelId = currentInFiltered
			? sessionModels.currentModelId
			: filtered[0].modelId;

		return {
			availableModels: filtered,
			currentModelId: effectiveModelId,
		};
	}, [sessionModels, agentId, candidateModels]);

	useEffect(() => {
		if (!filteredModels || !sessionModels || !sessionId) return;

		if (filteredModels.currentModelId !== sessionModels.currentModelId) {
			logger.log(
				`[useModelFiltering] Current model not in candidates, switching to ${filteredModels.currentModelId}`,
			);
			void setModel(filteredModels.currentModelId);
		}
	}, [filteredModels, sessionModels, sessionId, setModel, logger]);

	useEffect(() => {
		if (!sessionModels || !agentId) return;

		const candidates = candidateModels?.[agentId];
		if (!candidates || candidates.length === 0) return;

		const available = sessionModels.availableModels;
		const validCandidates = candidates.filter((id) =>
			available.some((m) => m.modelId === id),
		);

		if (validCandidates.length < candidates.length) {
			logger.log(
				`[useModelFiltering] Pruning ${candidates.length - validCandidates.length} stale candidate model(s) for ${agentId}`,
			);
			void settingsAccess.updateSettings({
				candidateModels: {
					...candidateModels,
					[agentId]: validCandidates,
				},
			});
		}
	}, [sessionModels, agentId, candidateModels, settingsAccess, logger]);

	return filteredModels;
}
