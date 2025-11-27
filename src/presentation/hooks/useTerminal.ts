// src/presentation/hooks/useTerminal.ts

import { useRef, useEffect, useCallback, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { PtyManager } from "../../infrastructure/pty";

/**
 * Computes actual color values from CSS variables.
 * xterm.js requires concrete color values, not CSS variable references.
 */
function computeTerminalTheme(): ITheme {
	const style = getComputedStyle(document.body);

	const getCssVar = (varName: string, fallback: string): string => {
		const value = style.getPropertyValue(varName).trim();
		return value || fallback;
	};

	return {
		background: getCssVar("--background-primary", "#1e1e1e"),
		foreground: getCssVar("--text-normal", "#d4d4d4"),
		cursor: getCssVar("--text-accent", "#569cd6"),
		cursorAccent: getCssVar("--background-primary", "#1e1e1e"),
		selectionBackground: getCssVar("--text-selection", "#264f78"),
		selectionForeground: getCssVar("--text-normal", "#d4d4d4"),
		selectionInactiveBackground: getCssVar("--text-selection", "#264f78"),
		black: "#1e1e1e",
		red: "#f44747",
		green: "#6a9955",
		yellow: "#dcdcaa",
		blue: "#569cd6",
		magenta: "#c586c0",
		cyan: "#4ec9b0",
		white: "#d4d4d4",
		brightBlack: "#808080",
		brightRed: "#f44747",
		brightGreen: "#6a9955",
		brightYellow: "#dcdcaa",
		brightBlue: "#569cd6",
		brightMagenta: "#c586c0",
		brightCyan: "#4ec9b0",
		brightWhite: "#ffffff",
	};
}

export interface UseTerminalOptions {
	ptyManager: PtyManager;
	isActive: boolean;
	fontSize?: number;
	fontFamily?: string;
	scrollback?: number;
}

export interface UseTerminalReturn {
	containerRef: React.RefObject<HTMLDivElement | null>;
	isReady: boolean;
	clear: () => void;
	focus: () => void;
}

/**
 * Hook for managing xterm.js terminal instance.
 */
export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
	const {
		ptyManager,
		isActive,
		fontSize = 14,
		fontFamily = "JetBrains Mono, Menlo, Monaco, monospace",
		scrollback = 10000,
	} = options;

	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const webglAddonRef = useRef<WebglAddon | null>(null);
	const [isReady, setIsReady] = useState(false);
	const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Initialize terminal
	useEffect(() => {
		if (!containerRef.current || terminalRef.current) return;

		const terminal = new Terminal({
			cursorBlink: true,
			fontSize,
			fontFamily,
			scrollback,
			smoothScrollDuration: 0,
			fastScrollModifier: "alt",
			theme: computeTerminalTheme(),
		});

		// Load addons
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		fitAddonRef.current = fitAddon;

		// Try WebGL, fallback to canvas
		try {
			const webglAddon = new WebglAddon();
			webglAddon.onContextLoss(() => {
				webglAddon.dispose();
				webglAddonRef.current = null;
			});
			terminal.loadAddon(webglAddon);
			webglAddonRef.current = webglAddon;
		} catch (e) {
			console.warn("WebGL addon failed, using canvas renderer:", e);
		}

		// Clickable links
		terminal.loadAddon(new WebLinksAddon());

		// Open terminal
		terminal.open(containerRef.current);
		fitAddon.fit();

		// Handle user input -> PTY
		terminal.onData((data) => {
			ptyManager.write(data);
		});

		// Handle resize
		terminal.onResize(({ cols, rows }) => {
			ptyManager.resize(cols, rows);
		});

		terminalRef.current = terminal;
		setIsReady(true);

		return () => {
			webglAddonRef.current?.dispose();
			terminal.dispose();
			terminalRef.current = null;
			setIsReady(false);
		};
	}, [fontSize, fontFamily, scrollback, ptyManager]);

	// Connect PTY output to terminal
	useEffect(() => {
		if (!terminalRef.current) return;

		const terminal = terminalRef.current;

		ptyManager.setOptions({
			onData: (data) => {
				terminal.write(data);
			},
			onExit: (code) => {
				terminal.writeln(`\r\n[Process exited with code ${code}]`);
			},
			onError: (error) => {
				terminal.writeln(`\r\n[Error: ${error}]`);
			},
		});
	}, [ptyManager, isReady]);

	// Update theme when Obsidian theme changes (light/dark mode)
	useEffect(() => {
		if (!terminalRef.current) return;

		const updateTheme = () => {
			if (terminalRef.current) {
				terminalRef.current.options.theme = computeTerminalTheme();
			}
		};

		// Obsidian uses a class on body to indicate theme: 'theme-dark' or 'theme-light'
		// MutationObserver watches for class changes on body element
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (
					mutation.type === "attributes" &&
					mutation.attributeName === "class"
				) {
					updateTheme();
					break;
				}
			}
		});

		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		});

		return () => {
			observer.disconnect();
		};
	}, [isReady]);

	// Handle container resize with debounce
	useEffect(() => {
		if (!containerRef.current || !fitAddonRef.current || !isActive) return;

		const handleResize = () => {
			if (resizeTimeoutRef.current) {
				clearTimeout(resizeTimeoutRef.current);
			}
			resizeTimeoutRef.current = setTimeout(() => {
				fitAddonRef.current?.fit();
			}, 50);
		};

		const resizeObserver = new ResizeObserver(handleResize);
		resizeObserver.observe(containerRef.current);

		// Initial fit when becoming active
		fitAddonRef.current.fit();

		return () => {
			resizeObserver.disconnect();
			if (resizeTimeoutRef.current) {
				clearTimeout(resizeTimeoutRef.current);
			}
		};
	}, [isActive]);

	// Focus terminal when tab becomes active
	useEffect(() => {
		if (isActive && terminalRef.current) {
			terminalRef.current.focus();
		}
	}, [isActive]);

	const clear = useCallback(() => {
		terminalRef.current?.clear();
	}, []);

	const focus = useCallback(() => {
		terminalRef.current?.focus();
	}, []);

	return {
		containerRef,
		isReady,
		clear,
		focus,
	};
}
