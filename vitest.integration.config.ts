import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
	test: {
		globals: true,
		include: ['tests/integration/**/*.test.ts'],
		testTimeout: 60000,
		setupFiles: ['tests/integration/helpers/load-settings-env.ts'],
	},
	resolve: {
		alias: {
			obsidian: resolve(__dirname, 'tests/integration/helpers/obsidian-integration-mock.ts'),
		},
	},
});
