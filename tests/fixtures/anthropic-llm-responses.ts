export interface AnthropicMessageResponse {
	id: string;
	type: string;
	role: string;
	model: string;
	content: { type: string; text: string }[];
	stop_reason: string;
	usage: { input_tokens: number; output_tokens: number };
}

export function createAnthropicMessageResponse(
	overrides?: Partial<AnthropicMessageResponse>,
): AnthropicMessageResponse {
	return {
		id: 'msg_test123',
		type: 'message',
		role: 'assistant',
		model: 'claude-sonnet-4-5-20250514',
		content: [
			{
				type: 'text',
				text: JSON.stringify({
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
		],
		stop_reason: 'end_turn',
		usage: { input_tokens: 100, output_tokens: 50 },
		...overrides,
	};
}

export function createAnthropicMessageWithStopReason(
	stopReason: string,
): AnthropicMessageResponse {
	const response = createAnthropicMessageResponse();
	response.stop_reason = stopReason;
	return response;
}

export function createAnthropicMessageWithContent(content: string): AnthropicMessageResponse {
	const response = createAnthropicMessageResponse();
	if (response.content[0]) {
		response.content[0].text = content;
	}
	return response;
}
