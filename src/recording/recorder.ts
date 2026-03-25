import { Notice } from 'obsidian';
import { StateManager } from '../state/state-manager';
import { PluginState } from '../state/types';
import { logger } from '../utils/logger';

type AudioFormat = 'webm' | 'm4a' | 'wav';

const MIME_CANDIDATES: Record<AudioFormat, string[]> = {
	webm: ['audio/webm;codecs=opus', 'audio/webm'],
	m4a: ['audio/mp4;codecs=aac', 'audio/mp4', 'audio/aac'],
	wav: ['audio/wav', 'audio/wave'],
};

function selectMimeType(format: AudioFormat): string {
	const candidates = MIME_CANDIDATES[format] ?? MIME_CANDIDATES['webm'];
	for (const mime of candidates) {
		if (MediaRecorder.isTypeSupported(mime)) return mime;
	}
	// Fallback to webm if requested format not supported
	for (const mime of MIME_CANDIDATES['webm']) {
		if (MediaRecorder.isTypeSupported(mime)) return mime;
	}
	return '';
}

export class Recorder {
	private mediaRecorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private stream: MediaStream | null = null;
	private activeMimeType = '';

	constructor(
		private stateManager: StateManager,
		private getAudioFormat: () => AudioFormat = () => 'webm',
	) {}

	async startRecording(): Promise<void> {
		if (this.mediaRecorder?.state === 'recording') return;

		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			this.chunks = [];

			const mimeType = selectMimeType(this.getAudioFormat());
			this.activeMimeType = mimeType;

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
				const blob = new Blob(this.chunks, { type: this.activeMimeType || 'audio/webm' });
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
