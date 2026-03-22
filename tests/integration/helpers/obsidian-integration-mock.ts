/**
 * Integration test mock for the 'obsidian' module.
 * Unlike the unit test mock, this provides a REAL requestUrl implementation
 * that makes actual HTTP calls using Node.js fetch.
 *
 * Only requestUrl and types needed by providers are exported.
 */

export interface RequestUrlParam {
	url: string;
	method?: string;
	contentType?: string;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
	json: unknown;
	text: string;
}

/**
 * Real requestUrl implementation using Node.js fetch.
 * Mirrors Obsidian's requestUrl behavior:
 * - When throw !== false and status >= 400, throws an error with { status } property
 * - When throw === false, returns the response regardless of status
 */
export async function requestUrl(params: RequestUrlParam | string): Promise<RequestUrlResponse> {
	const config = typeof params === 'string' ? { url: params } : params;
	const shouldThrow = config.throw !== false;

	const headers: Record<string, string> = { ...config.headers };
	if (config.contentType) {
		headers['Content-Type'] = config.contentType;
	}

	let fetchBody: BodyInit | undefined;
	if (config.body instanceof ArrayBuffer) {
		fetchBody = Buffer.from(config.body);
	} else {
		fetchBody = config.body;
	}

	const response = await fetch(config.url, {
		method: config.method ?? 'GET',
		headers,
		body: fetchBody,
	});

	const rawBuffer = await response.arrayBuffer();
	const text = new TextDecoder().decode(rawBuffer);
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}

	const responseHeaders: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		responseHeaders[key] = value;
	});

	const result: RequestUrlResponse = {
		status: response.status,
		headers: responseHeaders,
		arrayBuffer: rawBuffer,
		json,
		text,
	};

	if (shouldThrow && response.status >= 400) {
		const error = new Error(`Request failed, status ${response.status}`);
		Object.assign(error, { status: response.status, json, text, headers: responseHeaders });
		throw error;
	}

	return result;
}

// Stub exports that providers may import but don't need for integration tests
export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '');
}
