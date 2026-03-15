import { vi } from 'vitest';

export function createMockMediaStream() {
	const stopFn = vi.fn();
	return {
		getTracks: () => [{ stop: stopFn, kind: 'audio' }],
		getAudioTracks: () => [{ stop: stopFn, kind: 'audio', enabled: true }],
		getVideoTracks: () => [],
		active: true,
		_stopFn: stopFn,
	} as unknown as MediaStream & { _stopFn: ReturnType<typeof vi.fn> };
}

export class MockMediaRecorder extends EventTarget {
	state: RecordingState = 'inactive';
	stream: MediaStream;
	mimeType: string;

	ondataavailable: ((event: Event) => void) | null = null;
	onstop: ((event: Event) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	constructor(stream: MediaStream, options?: MediaRecorderOptions) {
		super();
		this.stream = stream;
		this.mimeType = options?.mimeType ?? 'audio/webm';
	}

	start(): void {
		this.state = 'recording';
	}

	stop(): void {
		this.state = 'inactive';
		const blob = new Blob(['mock-audio-data'], { type: this.mimeType });
		const dataEvent = new Event('dataavailable');
		Object.defineProperty(dataEvent, 'data', { value: blob });

		if (this.ondataavailable) {
			this.ondataavailable(dataEvent);
		}
		this.dispatchEvent(dataEvent);

		const stopEvent = new Event('stop');
		if (this.onstop) {
			this.onstop(stopEvent);
		}
		this.dispatchEvent(stopEvent);
	}

	pause(): void {
		this.state = 'paused';
	}

	resume(): void {
		this.state = 'recording';
	}

	static isTypeSupported(mimeType: string): boolean {
		return ['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].includes(mimeType);
	}
}
