import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		globals: true,
		environment: 'happy-dom',
		setupFiles: ['./test/setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: [
				'node_modules/',
				'test/',
				'*.config.*',
				'**/*.d.ts',
				'**/main.ts',
				'src/infrastructure/**',
				'src/presentation/**',
			],
			include: ['src/**/*.ts', 'src/**/*.tsx'],
		},
		alias: {
			obsidian: path.resolve(__dirname, './test/mocks/obsidian.ts'),
			'@codemirror/view': path.resolve(
				__dirname,
				'./test/mocks/codemirror.ts',
			),
			'@codemirror/state': path.resolve(
				__dirname,
				'./test/mocks/codemirror.ts',
			),
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
});
