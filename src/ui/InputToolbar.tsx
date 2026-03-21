import * as React from "react";
const { useRef, useEffect, useCallback } = React;
import { setIcon, DropdownComponent } from "obsidian";

import type {
	SessionModeState,
	SessionModelState,
	SessionUsage,
} from "../types/session";
import type {
	SessionConfigOption,
	SessionConfigSelectGroup,
	SessionConfigSelectOption,
} from "../types/session";

// ============================================================================
// Helpers
// ============================================================================

function flattenConfigSelectOptions(
	options: SessionConfigSelectOption[] | SessionConfigSelectGroup[],
): SessionConfigSelectOption[] {
	if (options.length === 0) return [];
	if ("value" in options[0]) return options as SessionConfigSelectOption[];
	return (options as SessionConfigSelectGroup[]).flatMap((g) => g.options);
}

/** Format token count for display (e.g., 21367 → "21.4K", 200000 → "200K") */
function formatTokenCount(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	const k = tokens / 1000;
	return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1)}K`;
}

/** Get CSS class for usage percentage color thresholds */
function getUsageColorClass(percentage: number): string {
	if (percentage >= 90) return "agent-client-usage-danger";
	if (percentage >= 80) return "agent-client-usage-warning";
	if (percentage >= 70) return "agent-client-usage-caution";
	return "agent-client-usage-normal";
}

// ============================================================================
// InputToolbar
// ============================================================================

export interface InputToolbarProps {
	isSending: boolean;
	isButtonDisabled: boolean;
	hasContent: boolean;
	onSendOrStop: () => void;
	modes?: SessionModeState;
	onModeChange?: (modeId: string) => void;
	models?: SessionModelState;
	onModelChange?: (modelId: string) => void;
	configOptions?: SessionConfigOption[];
	onConfigOptionChange?: (configId: string, value: string) => void;
	usage?: SessionUsage;
	isSessionReady: boolean;
}

export function InputToolbar({
	isSending,
	isButtonDisabled,
	hasContent,
	onSendOrStop,
	modes,
	onModeChange,
	models,
	onModelChange,
	configOptions,
	onConfigOptionChange,
	usage,
	isSessionReady,
}: InputToolbarProps) {
	// Refs
	const sendButtonRef = useRef<HTMLButtonElement>(null);
	const modeDropdownRef = useRef<HTMLDivElement>(null);
	const modeDropdownInstance = useRef<DropdownComponent | null>(null);
	const modelDropdownRef = useRef<HTMLDivElement>(null);
	const modelDropdownInstance = useRef<DropdownComponent | null>(null);
	const configOptionsRef = useRef<HTMLDivElement>(null);
	const configDropdownInstances = useRef<Map<string, DropdownComponent>>(
		new Map(),
	);

	// Stable callback refs
	const onModeChangeRef = useRef(onModeChange);
	onModeChangeRef.current = onModeChange;

	const onModelChangeRef = useRef(onModelChange);
	onModelChangeRef.current = onModelChange;

	const onConfigOptionChangeRef = useRef(onConfigOptionChange);
	onConfigOptionChangeRef.current = onConfigOptionChange;

	/**
	 * Update send button icon color based on state.
	 */
	const updateIconColor = useCallback(
		(svg: SVGElement) => {
			svg.classList.remove(
				"agent-client-icon-sending",
				"agent-client-icon-active",
				"agent-client-icon-inactive",
			);

			if (isSending) {
				svg.classList.add("agent-client-icon-sending");
			} else {
				svg.classList.add(
					hasContent
						? "agent-client-icon-active"
						: "agent-client-icon-inactive",
				);
			}
		},
		[isSending, hasContent],
	);

	// Update send button icon based on sending state
	useEffect(() => {
		if (sendButtonRef.current) {
			const iconName = isSending ? "square" : "send-horizontal";
			setIcon(sendButtonRef.current, iconName);
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [isSending, updateIconColor]);

	// Update icon color when hasContent changes
	useEffect(() => {
		if (sendButtonRef.current) {
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [updateIconColor]);

	// Initialize Mode dropdown (only when availableModes change)
	const availableModes = modes?.availableModes;
	const currentModeId = modes?.currentModeId;

	useEffect(() => {
		const containerEl = modeDropdownRef.current;
		if (!containerEl) return;

		// Only show dropdown if there are multiple modes
		if (!availableModes || availableModes.length <= 1) {
			// Clean up existing dropdown if modes become unavailable
			if (modeDropdownInstance.current) {
				containerEl.empty();
				modeDropdownInstance.current = null;
			}
			return;
		}

		// Create dropdown if not exists
		if (!modeDropdownInstance.current) {
			const dropdown = new DropdownComponent(containerEl);
			modeDropdownInstance.current = dropdown;

			// Add options
			for (const mode of availableModes) {
				dropdown.addOption(mode.id, mode.name);
			}

			// Set initial value
			if (currentModeId) {
				dropdown.setValue(currentModeId);
			}

			// Handle change - use ref to avoid recreating dropdown on callback change
			dropdown.onChange((value) => {
				if (onModeChangeRef.current) {
					onModeChangeRef.current(value);
				}
			});
		}

		// Cleanup on unmount or when availableModes change
		return () => {
			if (modeDropdownInstance.current) {
				containerEl.empty();
				modeDropdownInstance.current = null;
			}
		};
	}, [availableModes]);

	// Update dropdown value when currentModeId changes (separate effect)
	useEffect(() => {
		if (modeDropdownInstance.current && currentModeId) {
			modeDropdownInstance.current.setValue(currentModeId);
		}
	}, [currentModeId]);

	// Initialize Model dropdown (only when availableModels change)
	const availableModels = models?.availableModels;
	const currentModelId = models?.currentModelId;

	useEffect(() => {
		const containerEl = modelDropdownRef.current;
		if (!containerEl) return;

		// Only show dropdown if there are multiple models
		if (!availableModels || availableModels.length <= 1) {
			// Clean up existing dropdown if models become unavailable
			if (modelDropdownInstance.current) {
				containerEl.empty();
				modelDropdownInstance.current = null;
			}
			return;
		}

		// Create dropdown if not exists
		if (!modelDropdownInstance.current) {
			const dropdown = new DropdownComponent(containerEl);
			modelDropdownInstance.current = dropdown;

			// Add options
			for (const model of availableModels) {
				dropdown.addOption(model.modelId, model.name);
			}

			// Set initial value
			if (currentModelId) {
				dropdown.setValue(currentModelId);
			}

			// Handle change - use ref to avoid recreating dropdown on callback change
			dropdown.onChange((value) => {
				if (onModelChangeRef.current) {
					onModelChangeRef.current(value);
				}
			});
		}

		// Cleanup on unmount or when availableModels change
		return () => {
			if (modelDropdownInstance.current) {
				containerEl.empty();
				modelDropdownInstance.current = null;
			}
		};
	}, [availableModels]);

	// Update dropdown value when currentModelId changes (separate effect)
	useEffect(() => {
		if (modelDropdownInstance.current && currentModelId) {
			modelDropdownInstance.current.setValue(currentModelId);
		}
	}, [currentModelId]);

	// Initialize configOptions dropdowns (dynamic, replaces mode/model when present)
	useEffect(() => {
		const containerEl = configOptionsRef.current;
		if (!containerEl) return;

		// Clean up existing dropdowns
		containerEl.empty();
		configDropdownInstances.current.clear();

		if (!configOptions || configOptions.length === 0) return;

		for (const option of configOptions) {
			// Flatten options (handle both flat and grouped)
			const flatOptions = flattenConfigSelectOptions(option.options);

			// Only show if there are multiple values
			if (flatOptions.length <= 1) continue;

			// Create wrapper div with appropriate class based on category
			const categoryClass = option.category
				? `agent-client-config-selector-${option.category}`
				: "agent-client-config-selector";
			const wrapperEl = containerEl.createDiv({
				cls: `agent-client-config-selector ${categoryClass}`,
				attr: { title: option.description ?? option.name },
			});

			const dropdownContainer = wrapperEl.createDiv();
			const dropdown = new DropdownComponent(dropdownContainer);

			// Add options (with group prefix for grouped options)
			if (option.options.length > 0 && "group" in option.options[0]) {
				for (const group of option.options as SessionConfigSelectGroup[]) {
					for (const opt of group.options) {
						dropdown.addOption(
							opt.value,
							`${group.name} / ${opt.name}`,
						);
					}
				}
			} else {
				for (const opt of flatOptions) {
					dropdown.addOption(opt.value, opt.name);
				}
			}

			// Set current value
			dropdown.setValue(option.currentValue);

			// Handle change
			const configId = option.id;
			dropdown.onChange((value) => {
				if (onConfigOptionChangeRef.current) {
					onConfigOptionChangeRef.current(configId, value);
				}
			});

			// Add chevron icon
			const iconEl = wrapperEl.createSpan({
				cls: "agent-client-config-selector-icon",
			});
			setIcon(iconEl, "chevron-down");

			configDropdownInstances.current.set(option.id, dropdown);
		}

		return () => {
			containerEl.empty();
			configDropdownInstances.current.clear();
		};
	}, [configOptions]);

	return (
		<div className="agent-client-chat-input-actions">
			{/* Context Usage Indicator (left-aligned via margin-right: auto) */}
			{usage && (
				<span
					className={`agent-client-usage-indicator ${getUsageColorClass(Math.round((usage.used / usage.size) * 100))}`}
					aria-label={
						usage.cost
							? `${formatTokenCount(usage.used)} / ${formatTokenCount(usage.size)} tokens\n$${usage.cost.amount.toFixed(2)}`
							: `${formatTokenCount(usage.used)} / ${formatTokenCount(usage.size)} tokens`
					}
				>
					{Math.round((usage.used / usage.size) * 100)}%
				</span>
			)}

			{/* Config Options (supersedes legacy mode/model selectors) */}
			{configOptions && configOptions.length > 0 ? (
				<div
					ref={configOptionsRef}
					className="agent-client-config-options-container"
				/>
			) : (
				<>
					{/* Legacy Mode Selector */}
					{modes && modes.availableModes.length > 1 && (
						<div
							className="agent-client-mode-selector"
							title={
								modes.availableModes.find(
									(m) => m.id === modes.currentModeId,
								)?.description ?? "Select mode"
							}
						>
							<div ref={modeDropdownRef} />
							<span
								className="agent-client-mode-selector-icon"
								ref={(el) => {
									if (el) setIcon(el, "chevron-down");
								}}
							/>
						</div>
					)}

					{/* Legacy Model Selector */}
					{models && models.availableModels.length > 1 && (
						<div
							className="agent-client-model-selector"
							title={
								models.availableModels.find(
									(m) =>
										m.modelId ===
										models.currentModelId,
								)?.description ?? "Select model"
							}
						>
							<div ref={modelDropdownRef} />
							<span
								className="agent-client-model-selector-icon"
								ref={(el) => {
									if (el) setIcon(el, "chevron-down");
								}}
							/>
						</div>
					)}
				</>
			)}

			{/* Send/Stop Button */}
			<button
				ref={sendButtonRef}
				onClick={onSendOrStop}
				disabled={isButtonDisabled}
				className={`agent-client-chat-send-button ${isSending ? "sending" : ""} ${isButtonDisabled ? "agent-client-disabled" : ""}`}
				title={
					!isSessionReady
						? "Connecting..."
						: isSending
							? "Stop generation"
							: "Send message"
				}
			></button>
		</div>
	);
}
