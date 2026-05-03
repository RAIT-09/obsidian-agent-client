import * as React from "react";
const { useRef, useEffect, useCallback, useMemo } = React;
import { setIcon, Menu } from "obsidian";

import {
	flattenConfigSelectOptions,
	type SessionModeState,
	type SessionModelState,
	type SessionUsage,
	type SessionConfigOption,
	type SessionConfigSelectGroup,
} from "../types/session";

// ============================================================================
// ToolbarDropdown — themed dropdown using Obsidian's Menu
// ============================================================================

interface ToolbarDropdownItem {
	value: string;
	label: string;
	groupName?: string;
}

interface ToolbarDropdownProps {
	label: string;
	title: string;
	items: ToolbarDropdownItem[];
	currentValue: string | undefined;
	onChange: (value: string) => void;
	className?: string;
}

/**
 * Themed dropdown trigger. Uses Obsidian's Menu instead of a native <select>
 * so the open state respects Obsidian theme tokens, supports keyboard nav,
 * and can be positioned above the trigger to avoid covering the input.
 */
function ToolbarDropdown({
	label,
	title,
	items,
	currentValue,
	onChange,
	className,
}: ToolbarDropdownProps) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const chevronRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (chevronRef.current) {
			setIcon(chevronRef.current, "chevron-down");
		}
	}, []);

	const handleClick = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			e.preventDefault();
			e.stopPropagation();

			const menu = new Menu();

			menu.addItem((menuItem) => {
				menuItem.setTitle(title).setIsLabel(true);
			});

			let lastGroupName: string | undefined;
			for (const item of items) {
				if (
					item.groupName &&
					item.groupName !== lastGroupName &&
					lastGroupName !== undefined
				) {
					menu.addSeparator();
				}
				lastGroupName = item.groupName;

				menu.addItem((menuItem) => {
					menuItem
						.setTitle(item.label)
						.setChecked(item.value === currentValue)
						.onClick(() => {
							onChange(item.value);
						});
				});
			}

			menu.showAtMouseEvent(e.nativeEvent);
			buttonRef.current?.blur();
		},
		[items, currentValue, onChange],
	);

	const wrapperClass = `agent-client-toolbar-dropdown${className ? ` ${className}` : ""}`;

	return (
		<button
			ref={buttonRef}
			type="button"
			className={wrapperClass}
			title={title}
			onClick={handleClick}
		>
			<span className="agent-client-toolbar-dropdown-label-area">
				{items.map((item) => (
					<span
						key={item.value}
						className="agent-client-toolbar-dropdown-sizer"
					>
						{item.label}
					</span>
				))}
				<span className="agent-client-toolbar-dropdown-label">
					{label}
				</span>
			</span>
			<span
				ref={chevronRef}
				className="agent-client-toolbar-dropdown-chevron"
				aria-hidden="true"
			/>
		</button>
	);
}

// ============================================================================
// Utility Functions
// ============================================================================

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
	const sendButtonRef = useRef<HTMLButtonElement>(null);

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

	useEffect(() => {
		if (sendButtonRef.current) {
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [updateIconColor]);

	// ----- Build dropdown item lists (memoized) -----

	const modeItems = useMemo<ToolbarDropdownItem[]>(() => {
		if (!modes?.availableModes) return [];
		return modes.availableModes.map((m) => ({
			value: m.id,
			label: m.name,
		}));
	}, [modes]);

	const modelItems = useMemo<ToolbarDropdownItem[]>(() => {
		if (!models?.availableModels) return [];
		return models.availableModels.map((m) => ({
			value: m.modelId,
			label: m.name,
		}));
	}, [models]);

	const currentModeLabel = useMemo(() => {
		const id = modes?.currentModeId;
		return (
			modes?.availableModes?.find((m) => m.id === id)?.name ?? "Mode"
		);
	}, [modes]);

	const currentModelLabel = useMemo(() => {
		const id = models?.currentModelId;
		return (
			models?.availableModels?.find((m) => m.modelId === id)?.name ??
			"Model"
		);
	}, [models]);

	// ----- Render -----

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
			{configOptions && configOptions.length > 0
				? configOptions.map((option) => {
						const flatOptions = flattenConfigSelectOptions(
							option.options,
						);
						if (flatOptions.length <= 1) return null;

						const isGrouped =
							option.options.length > 0 &&
							"group" in option.options[0];

						let items: ToolbarDropdownItem[];
						if (isGrouped) {
							items = [];
							for (const group of option.options as SessionConfigSelectGroup[]) {
								for (const opt of group.options) {
									items.push({
										value: opt.value,
										label: `${group.name} / ${opt.name}`,
										groupName: group.name,
									});
								}
							}
						} else {
							items = flatOptions.map((opt) => ({
								value: opt.value,
								label: opt.name,
							}));
						}

						const currentItem = items.find(
							(it) => it.value === option.currentValue,
						);
						const label = currentItem?.label ?? option.name;
						const title = option.description ?? option.name;

						return (
							<ToolbarDropdown
								key={option.id}
								label={label}
								title={title}
								items={items}
								currentValue={option.currentValue}
								onChange={(value) => {
									onConfigOptionChange?.(option.id, value);
								}}
								className={
									option.category
										? `agent-client-config-selector-${option.category}`
										: undefined
								}
							/>
						);
					})
				: (
					<>
						{modes && modes.availableModes.length > 1 && onModeChange && (
							<ToolbarDropdown
								label={currentModeLabel}
								title={
									modes.availableModes.find(
										(m) => m.id === modes.currentModeId,
									)?.description ?? "Select mode"
								}
								items={modeItems}
								currentValue={modes.currentModeId ?? undefined}
								onChange={onModeChange}
							/>
						)}

						{models &&
							models.availableModels.length > 1 &&
							onModelChange && (
								<ToolbarDropdown
									label={currentModelLabel}
									title={
										models.availableModels.find(
											(m) =>
												m.modelId ===
												models.currentModelId,
										)?.description ?? "Select model"
									}
									items={modelItems}
									currentValue={
										models.currentModelId ?? undefined
									}
									onChange={onModelChange}
								/>
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
