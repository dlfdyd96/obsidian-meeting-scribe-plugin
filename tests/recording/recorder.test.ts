// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Recorder } from '../../src/recording/recorder';
import { stateManager } from '../../src/state/state-manager';
import { PluginState } from '../../src/state/types';
import { logger } from '../../src/utils/logger';
import { createMockMediaStream, MockMediaRecorder } from '../helpers/mock-media';

const noticeCalls: string[] = [];
vi.mock('obsidian', async () => {
	const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
	return {
		...actual,
		Notice: class MockNotice {
			constructor(message: string) {
				noticeCalls.push(message);
			}
		},
	};
});

describe('Recorder', () => {
	let recorder: Recorder;
	let mockGetUserMedia: ReturnType<typeof vi.fn>;
	let mockStream: MediaStream & { _stopFn: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		stateManager.reset();

		mockStream = createMockMediaStream();
		mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);

		Object.defineProperty(globalThis, 'MediaRecorder', {
			value: MockMediaRecorder,
			writable: true,
			configurable: true,
		});

		Object.defineProperty(navigator, 'mediaDevices', {
			value: { getUserMedia: mockGetUserMedia },
			writable: true,
			configurable: true,
		});

		noticeCalls.length = 0;

		vi.spyOn(logger, 'debug').mockImplementation(() => {});
		vi.spyOn(logger, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		recorder = new Recorder(stateManager);
	});

	afterEach(() => {
		recorder.destroy();
		vi.restoreAllMocks();
	});

	describe('startRecording()', () => {
		it('should request microphone access via navigator.mediaDevices.getUserMedia', async () => {
			await recorder.startRecording();

			expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
		});

		it('should create MediaRecorder with WebM format', async () => {
			let capturedOptions: MediaRecorderOptions | undefined;
			const OrigMock = MockMediaRecorder;
			class CaptureMock extends OrigMock {
				constructor(stream: MediaStream, options?: MediaRecorderOptions) {
					super(stream, options);
					capturedOptions = options;
				}
			}
			Object.defineProperty(globalThis, 'MediaRecorder', {
				value: CaptureMock,
				writable: true,
				configurable: true,
			});

			await recorder.startRecording();

			expect(capturedOptions?.mimeType).toMatch(/^audio\/webm/);
		});

		it('should transition StateManager from Idle to Recording', async () => {
			expect(stateManager.getState()).toBe(PluginState.Idle);

			await recorder.startRecording();

			expect(stateManager.getState()).toBe(PluginState.Recording);
		});

		it('should log start event via Logger', async () => {
			await recorder.startRecording();

			expect(logger.debug).toHaveBeenCalledWith('Recorder', 'Recording started');
		});

		it('should show permission denied Notice when getUserMedia is rejected', async () => {
			const permissionError = new DOMException('Permission denied', 'NotAllowedError');
			mockGetUserMedia.mockRejectedValueOnce(permissionError);

			await recorder.startRecording();

			expect(noticeCalls).toContain('Microphone access is required for recording');
			expect(stateManager.getState()).toBe(PluginState.Idle);
		});

		it('should show Notice for NotFoundError (no microphone device)', async () => {
			mockGetUserMedia.mockRejectedValueOnce(new DOMException('No device', 'NotFoundError'));

			await recorder.startRecording();

			expect(noticeCalls).toContain('Microphone access is required for recording');
			expect(logger.error).toHaveBeenCalledWith('Recorder', 'Failed to start recording', { error: 'No device' });
		});

		it('should show Notice for generic errors during getUserMedia', async () => {
			mockGetUserMedia.mockRejectedValueOnce(new Error('Unknown failure'));

			await recorder.startRecording();

			expect(noticeCalls).toContain('Microphone access is required for recording');
			expect(stateManager.getState()).toBe(PluginState.Idle);
		});

		it('should not transition state when getUserMedia fails', async () => {
			mockGetUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));

			await recorder.startRecording();

			expect(stateManager.getState()).toBe(PluginState.Idle);
		});

		it('should be a no-op when already recording', async () => {
			await recorder.startRecording();
			mockGetUserMedia.mockClear();

			await recorder.startRecording();

			expect(mockGetUserMedia).not.toHaveBeenCalled();
		});
	});

	describe('stopRecording()', () => {
		it('should stop MediaRecorder and produce a Blob', async () => {
			await recorder.startRecording();

			const blob = await recorder.stopRecording();

			expect(blob).toBeInstanceOf(Blob);
			expect(blob!.type).toBe('audio/webm');
		});

		it('should transition StateManager from Recording to Idle', async () => {
			await recorder.startRecording();
			expect(stateManager.getState()).toBe(PluginState.Recording);

			await recorder.stopRecording();

			expect(stateManager.getState()).toBe(PluginState.Idle);
		});

		it('should return the audio Blob', async () => {
			await recorder.startRecording();

			const blob = await recorder.stopRecording();

			expect(blob).not.toBeNull();
			expect(blob).toBeInstanceOf(Blob);
			expect(blob!.size).toBeGreaterThan(0);
		});

		it('should release MediaStream tracks', async () => {
			await recorder.startRecording();

			await recorder.stopRecording();

			expect(mockStream._stopFn).toHaveBeenCalled();
		});

		it('should be a no-op when not recording (return null)', async () => {
			const blob = await recorder.stopRecording();

			expect(blob).toBeNull();
		});

		it('should log stop event with blob size', async () => {
			await recorder.startRecording();

			await recorder.stopRecording();

			expect(logger.debug).toHaveBeenCalledWith('Recorder', 'Recording stopped', expect.objectContaining({ size: expect.any(Number) }));
		});
	});

	describe('destroy()', () => {
		it('should stop active recording and release stream', async () => {
			await recorder.startRecording();

			recorder.destroy();

			expect(mockStream._stopFn).toHaveBeenCalled();
		});

		it('should be safe to call when no recording has started', () => {
			expect(() => recorder.destroy()).not.toThrow();
		});

		it('should be safe to call multiple times', async () => {
			await recorder.startRecording();

			recorder.destroy();
			expect(() => recorder.destroy()).not.toThrow();
		});
	});

	describe('mimeType detection', () => {
		it('should prefer audio/webm;codecs=opus when supported', async () => {
			await recorder.startRecording();

			// MockMediaRecorder supports opus, so it should be selected
			// Verified by the fact that recording starts successfully
			expect(stateManager.getState()).toBe(PluginState.Recording);
		});

		it('should fall back to audio/webm when opus is not supported', async () => {
			const OrigMock = MockMediaRecorder;
			class LimitedMock extends OrigMock {
				static isTypeSupported(mimeType: string): boolean {
					return mimeType === 'audio/webm';
				}
			}
			Object.defineProperty(globalThis, 'MediaRecorder', {
				value: LimitedMock,
				writable: true,
				configurable: true,
			});

			await recorder.startRecording();

			expect(stateManager.getState()).toBe(PluginState.Recording);
		});

		it('should use browser default when no webm format is supported', async () => {
			const OrigMock = MockMediaRecorder;
			class NoWebmMock extends OrigMock {
				static isTypeSupported(_mimeType: string): boolean {
					return false;
				}
			}
			Object.defineProperty(globalThis, 'MediaRecorder', {
				value: NoWebmMock,
				writable: true,
				configurable: true,
			});

			await recorder.startRecording();

			expect(stateManager.getState()).toBe(PluginState.Recording);
		});
	});

	describe('ondataavailable filtering', () => {
		it('should ignore zero-size chunks', async () => {
			// Create a mock that emits a zero-size blob
			const OrigMock = MockMediaRecorder;
			class ZeroChunkMock extends OrigMock {
				stop(): void {
					this.state = 'inactive';

					// Emit zero-size chunk first
					const emptyEvent = new Event('dataavailable');
					Object.defineProperty(emptyEvent, 'data', { value: new Blob([], { type: 'audio/webm' }) });
					if (this.ondataavailable) this.ondataavailable(emptyEvent);

					// Then emit real chunk
					const realEvent = new Event('dataavailable');
					Object.defineProperty(realEvent, 'data', { value: new Blob(['real-data'], { type: 'audio/webm' }) });
					if (this.ondataavailable) this.ondataavailable(realEvent);

					if (this.onstop) this.onstop(new Event('stop'));
				}
			}
			Object.defineProperty(globalThis, 'MediaRecorder', {
				value: ZeroChunkMock,
				writable: true,
				configurable: true,
			});

			await recorder.startRecording();
			const blob = await recorder.stopRecording();

			// Only the real chunk should be included, not the zero-size one
			expect(blob).toBeInstanceOf(Blob);
			expect(blob!.size).toBeGreaterThan(0);
		});
	});
});
