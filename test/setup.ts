import '@testing-library/jest-dom';
import { vi } from 'vitest';

// グローバルなモック設定
// happy-dom already provides crypto, only mock if not available
if (!global.crypto || !global.crypto.randomUUID) {
	Object.defineProperty(global, 'crypto', {
		value: {
			randomUUID: () => Math.random().toString(36).substring(7),
		},
		writable: true,
		configurable: true,
	});
}

// console の一部をモック（テスト出力をクリーンに保つ）
const originalConsole = global.console;
global.console = {
	...console,
	log: vi.fn(), // デバッグログを抑制
	warn: vi.fn(),
	error: originalConsole.error, // エラーは表示
	info: vi.fn(),
	debug: vi.fn(),
};

// process.cwd() モック
if (!process.cwd) {
	process.cwd = () => '/test/vault';
}

// Mock require() for dynamic Obsidian imports
const Module = require('module');
const path = require('path');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id: string) {
	if (id === 'obsidian') {
		// Return mocked Obsidian module using absolute path
		const mockPath = path.join(__dirname, 'mocks', 'obsidian.ts');
		return originalRequire.call(this, mockPath);
	}
	return originalRequire.apply(this, arguments);
};
