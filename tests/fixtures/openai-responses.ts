export interface SimpleJsonResponse {
	text: string;
}

export interface VerboseJsonResponse {
	text: string;
	language: string;
	segments: { start: number; end: number; text: string }[];
}

export interface DiarizedJsonResponse {
	text: string;
	segments: { start: number; end: number; text: string; speaker: string }[];
}

export function createSimpleJsonResponse(
	overrides?: Partial<SimpleJsonResponse>,
): SimpleJsonResponse {
	return {
		text: 'Hello, this is a test transcription.',
		...overrides,
	};
}

export function createVerboseJsonResponse(
	overrides?: Partial<VerboseJsonResponse>,
): VerboseJsonResponse {
	return {
		text: 'Hello, this is a test transcription.',
		language: 'en',
		segments: [
			{ start: 0.0, end: 2.5, text: 'Hello, this is' },
			{ start: 2.5, end: 5.0, text: 'a test transcription.' },
		],
		...overrides,
	};
}

export function createDiarizedJsonResponse(
	overrides?: Partial<DiarizedJsonResponse>,
): DiarizedJsonResponse {
	return {
		text: 'Hello from speaker A. And hello from speaker B.',
		segments: [
			{ start: 0.0, end: 3.0, text: 'Hello from speaker A.', speaker: 'A' },
			{ start: 3.0, end: 6.0, text: 'And hello from speaker B.', speaker: 'B' },
		],
		...overrides,
	};
}

export function createRequestUrlSuccess(json: unknown): {
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
	json: unknown;
	text: string;
} {
	return {
		status: 200,
		headers: { 'content-type': 'application/json' },
		arrayBuffer: new ArrayBuffer(0),
		json,
		text: JSON.stringify(json),
	};
}

export function createRequestUrlError(
	status: number,
	body?: unknown,
): { status: number; headers: Record<string, string>; text: string; json: unknown } {
	const errorBody = body ?? { error: { message: 'Error', type: 'error' } };
	return {
		status,
		headers: {},
		text: JSON.stringify(errorBody),
		json: errorBody,
	};
}
