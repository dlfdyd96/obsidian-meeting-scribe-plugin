import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

// Re-export default brands from the plugin and add project-specific ones
const projectBrands = [
	// Plugin defaults (copied from eslint-plugin-obsidianmd/brands.js)
	'iOS', 'iPadOS', 'macOS', 'Windows', 'Android', 'Linux',
	'Obsidian', 'Obsidian Sync', 'Obsidian Publish',
	'Google Drive', 'Dropbox', 'OneDrive', 'iCloud Drive',
	'YouTube', 'Slack', 'Discord', 'Telegram', 'WhatsApp', 'Twitter', 'X',
	'Readwise', 'Zotero', 'Excalidraw', 'Mermaid',
	'Markdown', 'LaTeX', 'JavaScript', 'TypeScript', 'Node.js',
	'npm', 'pnpm', 'Yarn', 'Git', 'GitHub', 'GitLab',
	'Notion', 'Evernote', 'Roam Research', 'Logseq', 'Anki', 'Reddit',
	'VS Code', 'Visual Studio Code', 'IntelliJ IDEA', 'WebStorm', 'PyCharm',
	// Project-specific
	'OpenAI', 'Anthropic', 'Gemini',
];

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mjs',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			'obsidianmd/ui/sentence-case': ['error', {
				enforceCamelCaseLower: true,
				brands: projectBrands,
			}],
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.mts",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
