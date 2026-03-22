import { hasEnvVars, requireEnv } from '../../helpers/env-guard';
import { OpenAILLMProvider } from '../../../../src/providers/llm/openai-llm-provider';

const TEST_TRANSCRIPT = `
Speaker 1: Welcome to today's standup meeting. Let's go around the table.
Speaker 2: I finished the API integration yesterday and started working on the tests.
Speaker 1: Great. Any blockers?
Speaker 2: No blockers, should be done by end of day.
`.trim();

const SYSTEM_PROMPT = `You are a meeting notes assistant. Summarize the meeting transcript.
Return JSON with this structure: { "summary": "...", "metadata": { "title": "...", "participants": [...], "topics": [...], "tags": [...] } }`;

describe.skipIf(!hasEnvVars('OPENAI_API_KEY'))('OpenAI LLM Integration', () => {
	let provider: OpenAILLMProvider;

	beforeAll(() => {
		provider = new OpenAILLMProvider();
		provider.setCredentials({ type: 'api-key', apiKey: requireEnv('OPENAI_API_KEY') });
	});

	it('should validate a valid API key', async () => {
		const result = await provider.validateApiKey(requireEnv('OPENAI_API_KEY'));
		expect(result).toBe(true);
	});

	it('should return false for an invalid API key', async () => {
		const result = await provider.validateApiKey('sk-invalid-key-12345');
		expect(result).toBe(false);
	});

	it('should summarize transcript and return a valid SummaryResult', async () => {
		const result = await provider.summarize(SYSTEM_PROMPT, TEST_TRANSCRIPT);

		expect(result.provider).toBe('openai');
		expect(result.summary).toBeTruthy();
		expect(result.version).toBe(1);
		expect(result.createdAt).toBeTruthy();
		expect(result.model).toBeTruthy();
	});
});
