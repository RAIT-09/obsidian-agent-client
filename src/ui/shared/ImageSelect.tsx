import * as React from "react";
const { useCallback, useEffect, useMemo, useRef, useState } = React;
import { createPortal } from "react-dom";
import { setIcon } from "obsidian";

export interface ImageSelectOption {
	value: string;
	label: string;
	description?: string;
	imageSrc?: string | null;
}

export function ImageSelect({
	options,
	value,
	onChange,
	className,
	placeholder = "Select",
}: {
	options: ImageSelectOption[];
	value: string | undefined;
	onChange: (value: string) => void;
	className?: string;
	placeholder?: string;
}) {
	const [open, setOpen] = useState(false);
	const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const selected = useMemo(
		() => options.find((option) => option.value === value) ?? options[0],
		[options, value],
	);

	useEffect(() => {
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (
				!rootRef.current?.contains(target) &&
				!menuRef.current?.contains(target)
			) {
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", handlePointerDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
		};
	}, []);

	const updateMenuPosition = useCallback(() => {
		const trigger = triggerRef.current;
		if (!trigger) return;

		const rect = trigger.getBoundingClientRect();
		setMenuStyle({
			position: "fixed",
			top: rect.bottom + 4,
			left: rect.left,
			minWidth: Math.max(rect.width, 220),
			maxWidth: 320,
		});
	}, []);

	useEffect(() => {
		if (!open) return;

		updateMenuPosition();
		window.addEventListener("resize", updateMenuPosition);
		window.addEventListener("scroll", updateMenuPosition, true);
		return () => {
			window.removeEventListener("resize", updateMenuPosition);
			window.removeEventListener("scroll", updateMenuPosition, true);
		};
	}, [open, updateMenuPosition]);

	const choose = useCallback(
		(nextValue: string) => {
			setOpen(false);
			if (nextValue !== value) onChange(nextValue);
		},
		[onChange, value],
	);

	const stopPointerPropagation = useCallback(
		(event: React.PointerEvent | React.MouseEvent) => {
			event.stopPropagation();
		},
		[],
	);

	if (!selected) return null;

	return (
		<div
			ref={rootRef}
			className={`agent-client-image-select ${className ?? ""}`}
			onMouseDown={stopPointerPropagation}
			onPointerDown={stopPointerPropagation}
		>
			<button
				ref={triggerRef}
				type="button"
				className="agent-client-image-select-trigger"
				title={selected.description ?? selected.label}
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
			>
				<SelectImage option={selected} />
				<span className="agent-client-image-select-label">
					{selected.label || placeholder}
				</span>
				<span
					className="agent-client-image-select-chevron"
					ref={(el) => {
						if (el) setIcon(el, "chevron-down");
					}}
				/>
			</button>
			{open &&
				createPortal(
					<div
						ref={menuRef}
						className="agent-client-image-select-menu"
						role="listbox"
						style={menuStyle}
						onMouseDown={stopPointerPropagation}
						onPointerDown={stopPointerPropagation}
					>
						{options.map((option) => (
							<button
								key={option.value}
								type="button"
								className={`agent-client-image-select-option ${option.value === selected.value ? "is-selected" : ""}`}
								role="option"
								aria-selected={option.value === selected.value}
								title={option.description ?? option.label}
								onClick={() => choose(option.value)}
							>
								<SelectImage option={option} />
								<span className="agent-client-image-select-option-text">
									<span className="agent-client-image-select-label">
										{option.label}
									</span>
									{option.description && (
										<span className="agent-client-image-select-description">
											{option.description}
										</span>
									)}
								</span>
							</button>
						))}
					</div>,
					document.body,
				)}
		</div>
	);
}

function SelectImage({ option }: { option: ImageSelectOption }) {
	if (option.imageSrc) {
		return (
			<img
				src={option.imageSrc}
				alt=""
				className="agent-client-image-select-image"
			/>
		);
	}
	return null;
}
