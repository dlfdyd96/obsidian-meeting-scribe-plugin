// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMediaStream, MockMediaRecorder } from '../helpers/mock-media';

describe('MediaRecorder PoC', () => {
	beforeEach(() => {
		// Set up navigator.mediaDevices mock
		Object.defineProperty(globalThis, 'MediaRecorder', {
			value: MockMediaRecorder,
			writable: true,
			configurable: true,
		});

		const mockGetUserMedia = vi.fn().mockResolvedValue(createMockMediaStream());
		Object.defineProperty(navigator, 'mediaDevices', {
			value: { getUserMedia: mockGetUserMedia },
			writable: true,
			configurable: true,
		});
	});

	it('should create a MediaRecorder instance from getUserMedia stream', async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const recorder = new MediaRecorder(stream);

		expect(recorder).toBeDefined();
		expect(recorder.state).toBe('inactive');
		expect(recorder.stream).toBe(stream);
	});

	it('should transition state to "recording" when start() is called', async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const recorder = new MediaRecorder(stream);

		expect(recorder.state).toBe('inactive');
		recorder.start();
		expect(recorder.state).toBe('recording');
	});

	it('should produce a Blob via dataavailable event when stop() is called', async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const recorder = new MediaRecorder(stream);

		const blobPromise = new Promise<Blob>((resolve) => {
			recorder.addEventListener('dataavailable', (event: Event) => {
				const data = (event as unknown as { data: Blob }).data;
				resolve(data);
			});
		});

		recorder.start();
		recorder.stop();

		const blob = await blobPromise;
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.size).toBeGreaterThan(0);
		expect(blob.type).toBe('audio/webm');
	});

	it('should collect Blob data via ondataavailable callback', async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const recorder = new MediaRecorder(stream);
		const chunks: Blob[] = [];

		recorder.ondataavailable = (event: Event) => {
			const data = (event as unknown as { data: Blob }).data;
			chunks.push(data);
		};

		recorder.start();
		recorder.stop();

		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toBeInstanceOf(Blob);
		expect(chunks[0].size).toBeGreaterThan(0);
	});

	it('should handle microphone permission denial gracefully', async () => {
		const permissionError = new DOMException(
			'Permission denied',
			'NotAllowedError',
		);
		vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(permissionError);

		try {
			await navigator.mediaDevices.getUserMedia({ audio: true });
			// Should not reach here
			expect.unreachable('getUserMedia should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(DOMException);
			expect((error as DOMException).name).toBe('NotAllowedError');
			expect((error as DOMException).message).toBe('Permission denied');
		}
	});
});
