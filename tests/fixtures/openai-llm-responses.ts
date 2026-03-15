export interface ChatCompletionResponse {
	id: string;
	model: string;
	choices: {
		index: number;
		message: { role: string; content: string };
		finish_reason: string;
	}[];
	usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export function createChatCompletionResponse(
	overrides?: Partial<ChatCompletionResponse>,
): ChatCompletionResponse {
	return {
		id: 'chatcmpl-test123',
		model: 'gpt-4o-mini-2024-07-18',
		choices: [
			{
				index: 0,
				message: {
					role: 'assistant',
					content: JSON.stringify({
						summary: 'This meeting covered project updates and next steps.',
						metadata: {
							date: '2026-03-16',
							title: 'Weekly Standup',
							participants: ['Alice', 'Bob'],
							topics: ['project updates', 'next steps'],
							tags: ['standup', 'weekly'],
						},
					}),
				},
				finish_reason: 'stop',
			},
		],
		usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
		...overrides,
	};
}

export function createChatCompletionWithFinishReason(
	finishReason: string,
): ChatCompletionResponse {
	const response = createChatCompletionResponse();
	if (response.choices[0]) {
		response.choices[0].finish_reason = finishReason;
	}
	return response;
}

export function createChatCompletionWithContent(content: string): ChatCompletionResponse {
	const response = createChatCompletionResponse();
	if (response.choices[0]) {
		response.choices[0].message.content = content;
	}
	return response;
}
