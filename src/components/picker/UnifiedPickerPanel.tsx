import * as React from "react";
import type { UsePickerReturn } from "../../hooks/usePicker";
import { type PickerItem, type PickerMode, type PickerTreeNode } from "./types";
import { ObsidianIcon } from "../chat/ObsidianIcon";

const { useRef, useEffect, useCallback } = React;

interface PickerPanelProps {
	picker: UsePickerReturn;
	mode: PickerMode;
}

/* ------------------------------------------------------------------ */
/*  Item rows                                                         */
/* ------------------------------------------------------------------ */

function PickerItemRow({
	item,
	isSelected,
	onClick,
	onHover,
}: {
	item: PickerItem;
	isSelected: boolean;
	onClick: () => void;
	onHover: () => void;
}) {
	if (item.isBack) {
		return (
			<div
				className={`obsius-picker-item obsius-picker-item--back${isSelected ? " obsius-picker-item--selected" : ""}`}
				data-selected={isSelected}
				onClick={onClick}
				onMouseEnter={onHover}
			>
				<ObsidianIcon
					name="chevron-left"
					className="obsius-picker-item-icon"
					size={14}
				/>
				<span className="obsius-picker-item-label">{item.label}</span>
			</div>
		);
	}

	if (item.isCategory) {
		return (
			<div
				className={`obsius-picker-item obsius-picker-item--category${isSelected ? " obsius-picker-item--selected" : ""}`}
				data-selected={isSelected}
				onClick={onClick}
				onMouseEnter={onHover}
			>
				<ObsidianIcon
					name={item.icon}
					className="obsius-picker-item-icon"
					size={16}
				/>
				<span className="obsius-picker-item-label">{item.label}</span>
				<ObsidianIcon
					name="chevron-right"
					className="obsius-picker-item-chevron"
					size={14}
				/>
			</div>
		);
	}

	return (
		<div
			className={`obsius-picker-item${isSelected ? " obsius-picker-item--selected" : ""}`}
			data-selected={isSelected}
			onClick={onClick}
			onMouseEnter={onHover}
		>
			{item.badge ? (
				<span className="obsius-picker-badge">
					<ObsidianIcon
						name={item.badge.icon}
						className="obsius-picker-badge-icon"
						size={10}
					/>
					{item.badge.label}
				</span>
			) : (
				<ObsidianIcon
					name={item.icon}
					className="obsius-picker-item-icon"
					size={16}
				/>
			)}
			<span className="obsius-picker-item-label">{item.label}</span>
			{item.sublabel && (
				<span className="obsius-picker-item-desc">
					{item.sublabel}
				</span>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Detail pane (independent floating panel)                          */
/* ------------------------------------------------------------------ */

function TreePreview({ nodes }: { nodes: PickerTreeNode[] }) {
	return (
		<div className="obsius-picker-tree">
			{nodes.map((node, i) => (
				<TreeNode key={i} node={node} depth={0} />
			))}
		</div>
	);
}

function TreeNode({ node, depth }: { node: PickerTreeNode; depth: number }) {
	return (
		<>
			<div
				className="obsius-picker-tree-node"
				style={{ paddingLeft: `${depth * 16 + 8}px` }}
			>
				<ObsidianIcon name={node.icon} size={14} />
				<span>{node.name}</span>
			</div>
			{node.children?.map((child, i) => (
				<TreeNode key={i} node={child} depth={depth + 1} />
			))}
		</>
	);
}

function DetailPanel({ preview }: { preview: UsePickerReturn["preview"] }) {
	if (!preview) return null;

	if (preview.tree && preview.tree.length > 0) {
		return (
			<div className="obsius-picker-detail">
				<TreePreview nodes={preview.tree} />
			</div>
		);
	}

	if (!preview.body && !preview.title) return null;

	return (
		<div className="obsius-picker-detail">
			{preview.title && (
				<div className="obsius-picker-detail-title">{preview.title}</div>
			)}
			{preview.body && (
				<div className="obsius-picker-detail-body">{preview.body}</div>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Main panel                                                        */
/* ------------------------------------------------------------------ */

export function UnifiedPickerPanel({ picker, mode }: PickerPanelProps) {
	const listRef = useRef<HTMLDivElement>(null);
	const pickerRef = useRef(picker);
	pickerRef.current = picker;

	useEffect(() => {
		if (!listRef.current) return;
		const selected =
			listRef.current.querySelector<HTMLElement>("[data-selected='true']");
		selected?.scrollIntoView({ block: "nearest" });
	}, [picker.selectedIndex]);

	const handleItemSelect = useCallback((index: number) => {
		pickerRef.current.selectAt(index);
	}, []);

	const handleItemHover = useCallback((index: number) => {
		pickerRef.current.setSelectedIndex(index);
	}, []);

	return (
		<div
			className={`obsius-picker-wrapper obsius-picker-wrapper--${mode}`}
			onMouseDown={(e) => e.preventDefault()}
		>
			<div className="obsius-picker-panel">
				<div className="obsius-picker-list" ref={listRef}>
					{picker.items.length === 0 && (
						<div className="obsius-picker-empty">No results</div>
					)}
					{picker.items.map((item, idx) => (
						<PickerItemRow
							key={item.id}
							item={item}
							isSelected={idx === picker.selectedIndex}
							onClick={() => handleItemSelect(idx)}
							onHover={() => handleItemHover(idx)}
						/>
					))}
				</div>
			</div>

			<DetailPanel preview={picker.preview} />
		</div>
	);
}
