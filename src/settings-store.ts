import type { AgentClientPluginSettings } from "./main";

type Listener = () => void;

class SettingsStore {
	private state: AgentClientPluginSettings;
	private listeners = new Set<Listener>();

	constructor(initial: AgentClientPluginSettings) {
		this.state = initial;
	}

	getSnapshot = (): AgentClientPluginSettings => this.state;

	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	set(next: AgentClientPluginSettings) {
		this.state = next;
		for (const listener of this.listeners) {
			listener();
		}
	}
}

export const createSettingsStore = (initial: AgentClientPluginSettings) =>
	new SettingsStore(initial);

export type { SettingsStore };
