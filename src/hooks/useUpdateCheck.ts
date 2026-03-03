import { useState, useEffect } from "react";
import type AgentClientPlugin from "../plugin";
import { getLogger } from "../shared/logger";

export function useUpdateCheck(plugin: AgentClientPlugin): boolean {
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
	const logger = getLogger();

	useEffect(() => {
		let isCancelled = false;
		setIsUpdateAvailable(false);

		plugin
			.checkForUpdates()
			.then((hasUpdate) => {
				if (!isCancelled) {
					setIsUpdateAvailable(hasUpdate);
				}
			})
			.catch((error) => {
				logger.error("Failed to check for updates:", error);
				if (!isCancelled) {
					setIsUpdateAvailable(false);
				}
			});

		return () => {
			isCancelled = true;
		};
	}, [plugin]);

	return isUpdateAvailable;
}
