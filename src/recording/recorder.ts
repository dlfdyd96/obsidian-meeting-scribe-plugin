import { Notice } from 'obsidian';
import { StateManager } from '../state/state-manager';
import { PluginState } from '../state/types';
import { logger } from '../utils/logger';

export class Recorder {
	private mediaRecorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private stream: MediaStream | null = null;

	constructor(private stateManager: StateManager) {}

	async startRecording(): Promise<void> {
		if (this.mediaRecorder?.state === 'recording') return;

		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			this.chunks = [];

			const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
				? 'audio/webm;codecs=opus'
				: MediaRecorder.isTypeSupported('audio/webm')
					? 'audio/webm'
					: '';

			const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
			this.mediaRecorder = new MediaRecorder(this.stream, options);

			this.mediaRecorder.ondataavailable = (event: Event) => {
				const data = (event as unknown as { data: Blob }).data;
				if (data.size > 0) this.chunks.push(data);
			};

			this.mediaRecorder.start();
			this.stateManager.setState(PluginState.Recording);
			logger.debug('Recorder', 'Recording started');
		} catch (err) {
			logger.error('Recorder', 'Failed to start recording', { error: (err as Error).message });
			new Notice('Microphone access is required for recording');
		}
	}

	async stopRecording(): Promise<Blob | null> {
		if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return null;

		return new Promise((resolve) => {
			this.mediaRecorder!.onstop = () => {
				const blob = new Blob(this.chunks, { type: 'audio/webm' });
				this.releaseStream();
				this.stateManager.setState(PluginState.Idle);
				logger.debug('Recorder', 'Recording stopped', { size: blob.size });
				resolve(blob);
			};
			this.mediaRecorder!.stop();
		});
	}

	private releaseStream(): void {
		this.stream?.getTracks().forEach(track => track.stop());
		this.stream = null;
	}

	destroy(): void {
		if (this.mediaRecorder?.state === 'recording') {
			this.mediaRecorder.stop();
		}
		this.releaseStream();
	}
}
