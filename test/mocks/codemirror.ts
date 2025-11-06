/**
 * CodeMirror Mock for Testing
 */

import { vi } from 'vitest';

export class EditorView {
	static updateListener = {
		of: vi.fn(() => ({})),
	};

	dispatch = vi.fn();
}

export class Compartment {
	of = vi.fn(() => ({}));
	reconfigure = vi.fn(() => ({}));
}

export class StateEffect {
	static appendConfig = {
		of: vi.fn(() => ({})),
	};
}
