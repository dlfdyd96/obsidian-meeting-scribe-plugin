import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
	test: {
		globals: true,
		include: ['tests/**/*.test.ts'],
	},
	resolve: {
		alias: {
			obsidian: resolve(__dirname, 'tests/helpers/obsidian-mock.ts'),
		},
	},
});
