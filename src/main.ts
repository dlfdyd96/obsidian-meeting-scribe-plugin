import { MarkdownView, Notice, Platform, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { migrateSettings } from './settings/settings-migration';
import { MeetingScribeSettingTab } from './settings/settings-tab';
import { Recorder } from './recording/recorder';
import { AudioFileManager } from './recording/audio-file-manager';
import { StatusBar } from './ui/status-bar';
import { RibbonHandler } from './ui/ribbon-handler';
import { AudioSuggestModal } from './ui/audio-suggest-modal';
import { stateManager } from './state/state-manager';
import { PluginState } from './state/types';
import { NoticeManager } from './ui/notices';
import { Pipeline } from './pipeline/pipeline';
import { TranscribeStep } from './pipeline/steps/transcribe-step';
import { SummarizeStep } from './pipeline/steps/summarize-step';
import { GenerateNoteStep } from './pipeline/steps/generate-note-step';
import { PipelineDispatcher } from './pipeline/pipeline-dispatcher';
import { SessionManager } from './session/session-manager';
import { providerRegistry } from './providers/provider-registry';
import { OpenAISTTProvider } from './providers/stt/openai-stt-provider';
import { ClovaSpeechSTTProvider } from './providers/stt/clova-stt-provider';
import { GeminiSTTProvider } from './providers/stt/gemini-stt-provider';
import { OpenAILLMProvider } from './providers/llm/openai-llm-provider';
import { AnthropicLLMProvider } from './providers/llm/anthropic-llm-provider';
import { PLUGIN_ID, PLUGIN_NAME, NOTICE_RETRY_TIMEOUT_MS, TEST_RECORDING_DURATION_MS } from './constants';
import { logger } from './utils/logger';
import { hasSTTCredentials } from './settings/settings';

import { applyParticipantReplacements, parseParticipantsFromYaml, parseFrontmatter } from './note/note-generator';
import type { MeetingScribeSettings } from './settings/settings';
import { TranscriptSidebarView } from './ui/sidebar/transcript-sidebar-view';
import type { PipelineContext } from './pipeline/pipeline-types';

const COMPONENT = 'MeetingScribePlugin';

export interface TestRecordingResult {
	success: boolean;
	transcriptPreview?: string;
	noteFilePath?: string;
	error?: string;
	failedStep?: string;
}

export default class MeetingScribePlugin extends Plugin {
	settings!: MeetingScribeSettings;
	private recorder!: Recorder;
	private audioFileManager!: AudioFileManager;
	private statusBar!: StatusBar;
	private ribbonHandler!: RibbonHandler;
	noticeManager!: NoticeManager;
	private sessionManager!: SessionManager;
	private dispatcher!: PipelineDispatcher;
	private pipelineAborted = false;
	private recordingAvailable = true;
	private currentRecordingSessionId: string | null = null;

	async onload() {
		const data: unknown = await this.loadData();
		this.settings = migrateSettings(data);
		logger.setDebugMode(this.settings.debugMode);
		this.addSettingTab(new MeetingScribeSettingTab(this.app, this));

		providerRegistry.registerSTTProvider(new OpenAISTTProvider());
		providerRegistry.registerSTTProvider(new ClovaSpeechSTTProvider());
		providerRegistry.registerSTTProvider(new GeminiSTTProvider());
		providerRegistry.registerLLMProvider(new OpenAILLMProvider());
		providerRegistry.registerLLMProvider(new AnthropicLLMProvider());

		this.recorder = new Recorder(stateManager, () => this.settings.audioFormat);
		this.audioFileManager = new AudioFileManager(
			this.app.vault,
			() => this.settings.audioFolder,
			() => this.settings.audioFormat,
		);

		this.sessionManager = new SessionManager();
		this.dispatcher = new PipelineDispatcher(
			this.sessionManager,
			this.app.vault,
			() => this.settings,
		);

		const startRecordingFlow = (): void => {
			if (!this.recordingAvailable) {
				this.noticeManager.showRecordingUnavailable();
				return;
			}
			if (!hasSTTCredentials(this.settings) || !this.settings.llmApiKey) {
				this.noticeManager.showMissingApiKeys();
				return;
			}
			if (this.settings.showConsentReminder) {
				this.noticeManager.showConsentReminder();
			}
			void this.recorder.startRecording();

			// Create session with recording status so sidebar shows red dot
			const session = this.sessionManager.createSession('recording-in-progress');
			this.sessionManager.updateSessionState(session.id, { status: 'recording' });
			this.currentRecordingSessionId = session.id;
		};

		const stopRecordingFlow = (): void => {
			void (async () => {
				try {
					const blob = await this.recorder.stopRecording();
					if (blob) {
						const audioPath = await this.audioFileManager.saveRecording(blob);
						if (this.currentRecordingSessionId) {
							this.sessionManager.updateSessionAudioFile(this.currentRecordingSessionId, audioPath);
							this.startProcessingFlow(audioPath, this.currentRecordingSessionId);
						} else {
							this.startProcessingFlow(audioPath);
						}
					}
					this.currentRecordingSessionId = null;
				} catch (err) {
					this.currentRecordingSessionId = null;
					logger.error(COMPONENT, 'Failed to save recording', { error: (err as Error).message });
				}
			})();
		};

		this.noticeManager = new NoticeManager(
			this.app,
			() => {
				// Retry is now handled by SessionManager/Sidebar (Epic 12)
				// For now, log that retry was requested
				logger.info(COMPONENT, 'Retry requested via notice');
			},
			PLUGIN_ID,
		);

		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new StatusBar(
			statusBarEl,
			stateManager,
			startRecordingFlow,
			stopRecordingFlow,
			(path: string) => {
				void this.app.workspace.openLinkText(path, '', false);
			},
			(error: Error, step?: string) => {
				this.noticeManager.showError(step ?? 'Processing', error);
			},
		);

		const ribbonEl = this.addRibbonIcon('mic', `${PLUGIN_NAME}: Start recording`, () => {
			// Initial callback — RibbonHandler takes over click behavior
		});
		this.ribbonHandler = new RibbonHandler(
			ribbonEl,
			stateManager,
			startRecordingFlow,
			stopRecordingFlow,
		);

		this.addCommand({
			id: 'start-recording',
			name: 'Start recording',
			callback: () => {
				const state = stateManager.getState();
				if (state === PluginState.Idle || state === PluginState.Recording) {
					if (state === PluginState.Idle) {
						startRecordingFlow();
					}
				} else if (state === PluginState.Error) {
					stateManager.setState(PluginState.Idle);
					startRecordingFlow();
				}
			},
		});

		this.addCommand({
			id: 'stop-recording',
			name: 'Stop recording',
			callback: () => {
				if (stateManager.getState() === PluginState.Recording) {
					stopRecordingFlow();
				}
			},
		});

		this.addCommand({
			id: 'toggle-recording',
			name: 'Toggle recording',
			callback: () => {
				const state = stateManager.getState();
				if (state === PluginState.Idle) {
					startRecordingFlow();
				} else if (state === PluginState.Error) {
					stateManager.setState(PluginState.Idle);
					startRecordingFlow();
				} else if (state === PluginState.Recording) {
					stopRecordingFlow();
				}
			},
		});

		this.addCommand({
			id: 'import-audio',
			name: 'Import audio file',
			callback: () => {
				const state = stateManager.getState();
				if (state !== PluginState.Recording) {
					if (state === PluginState.Error) stateManager.setState(PluginState.Idle);
					const modal = new AudioSuggestModal(this.app, (filePath: string) => {
						this.startProcessingFlow(filePath);
					});
					modal.open();
				}
			},
		});

		this.addCommand({
			id: 'update-participant-names',
			name: 'Update participant names',
			callback: () => {
				void this.updateParticipantNames();
			},
		});

		if (Platform.isMobile && (typeof MediaRecorder === 'undefined')) {
			this.recordingAvailable = false;
			this.noticeManager.showRecordingUnavailable();
		}

		// Passive microphone availability check (non-blocking, warning only)
		void navigator.mediaDevices?.enumerateDevices().then(devices => {
			const hasMic = devices.some(d => d.kind === 'audioinput');
			if (!hasMic) {
				logger.warn(COMPONENT, 'No microphone detected');
			}
		}).catch(() => {
			logger.warn(COMPONENT, 'Could not enumerate media devices');
		});

		if (!this.settings.onboardingComplete && this.settings.sttApiKey === '' && this.settings.llmApiKey === '') {
			this.app.workspace.onLayoutReady(() => {
				this.noticeManager.showWelcome();
				const setting = (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting;
				setting.open();
				setting.openTabById(PLUGIN_ID);
			});
			this.settings.onboardingComplete = true;
			void this.saveSettings();
		}

		// Subscribe to session state changes for user notifications
		this.sessionManager.subscribe((_sessionId, session) => {
			if (session.pipeline.status === 'complete') {
				const notePath = session.pipeline.noteFilePath ?? session.transcriptFile.replace('.transcript.json', '.md');
				this.noticeManager.showSuccess(notePath);
				void this.applyRetentionPolicy(session.audioFile);
			} else if (session.pipeline.status === 'error' && session.pipeline.error) {
				this.noticeManager.showError(
					session.pipeline.failedStep ?? 'Processing',
					new Error(session.pipeline.error),
				);
			}
		});

		// Register Transcript Sidebar view
		this.registerView(
			TranscriptSidebarView.VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new TranscriptSidebarView(
				leaf,
				this.sessionManager,
				(sessionId: string) => { void this.dispatcher.retrySession(sessionId); },
				() => this.settings,
				async () => { await this.dispatcher.recoverSessions(); },
			),
		);

		this.addCommand({
			id: 'open-transcript-sidebar',
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- command name
			name: 'Open Transcript Sidebar',
			callback: () => {
				void this.activateSidebarView();
			},
		});

		this.addCommand({
			id: 'audio-play-pause',
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- command name
			name: 'Play/Pause audio',
			callback: () => {
				this.getActiveSidebarView()?.toggleAudio();
			},
		});

		this.addCommand({
			id: 'audio-skip-back',
			name: 'Skip back 5 seconds',
			callback: () => {
				this.getActiveSidebarView()?.skipAudio(-5);
			},
		});

		this.addCommand({
			id: 'audio-skip-forward',
			name: 'Skip forward 5 seconds',
			callback: () => {
				this.getActiveSidebarView()?.skipAudio(5);
			},
		});

		// Recover sessions first, then enable auto-open to avoid race condition
		const sessionRecovery = this.dispatcher.recoverSessions().then(count => {
			if (count > 0) {
				logger.info(COMPONENT, 'Recovered sessions', { count });
				this.getActiveSidebarView()?.showSessionList();
			}
		});

		// Auto-open sidebar when a meeting note becomes active
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (!this.settings.autoOpenSidebar) return;
				if (!leaf) return;
				const leafView = leaf.view;
				if (!(leafView instanceof MarkdownView)) return;
				const file = leafView.file;
				if (!file) return;

				const tryAutoOpen = (): void => {
					const cache = this.app.metadataCache.getFileCache(file);
					const transcriptDataPath = cache?.frontmatter?.['transcript_data'] as string | undefined;
					if (transcriptDataPath) {
						// Wait for session recovery before opening transcript
						void sessionRecovery.then(() => this.handleMeetingNoteOpened(file.path, transcriptDataPath));
					}
				};

				// metadataCache may not have frontmatter parsed yet on first open
				const cache = this.app.metadataCache.getFileCache(file);
				const transcriptDataPath = cache?.frontmatter?.['transcript_data'] as string | undefined;
				if (transcriptDataPath) {
					void sessionRecovery.then(() => this.handleMeetingNoteOpened(file.path, transcriptDataPath));
				} else if (!cache?.frontmatter) {
					setTimeout(tryAutoOpen, 300);
				}
			}),
		);

		logger.debug(COMPONENT, 'Plugin loaded');
	}

	private startProcessingFlow(audioFilePath: string, existingSessionId?: string): void {
		void this.dispatcher.dispatch(audioFilePath, existingSessionId);
		new Notice('Processing started...', NOTICE_RETRY_TIMEOUT_MS);
	}

	private async applyRetentionPolicy(audioFilePath: string): Promise<void> {
		if (this.settings.audioRetentionPolicy === 'delete') {
			const file = this.app.vault.getAbstractFileByPath(audioFilePath);
			if (file instanceof TFile) {
				await this.app.fileManager.trashFile(file);
				logger.info(COMPONENT, 'Audio file trashed per retention policy', { audioFilePath });
			}
		}
	}

	async runTestRecording(onProgress?: (step: string) => void): Promise<TestRecordingResult> {
		const STEP_NAMES = ['transcribing', 'summarizing', 'generating'];

		try {
			await this.recorder.startRecording();
			await new Promise(resolve => setTimeout(resolve, TEST_RECORDING_DURATION_MS));
			const blob = await this.recorder.stopRecording();

			if (!blob) {
				return { success: false, error: 'No audio recorded', failedStep: 'recording' };
			}

			const testAudioPath = `${this.settings.audioFolder}/_test-recording.webm`;
			await this.audioFileManager.saveRecordingToPath(blob, testAudioPath);

			const context: PipelineContext = {
				audioFilePath: testAudioPath,
				vault: this.app.vault,
				settings: this.settings,
				onProgress: (step: string) => {
					onProgress?.(step);
					logger.debug(COMPONENT, 'Test pipeline progress', { step });
				},
				isAborted: () => false,
			};

			const steps = [new TranscribeStep(), new SummarizeStep(), new GenerateNoteStep()];
			const pipeline = new Pipeline();
			const result = await pipeline.execute(steps, context);

			// Clean up test audio file
			const audioFile = this.app.vault.getAbstractFileByPath(testAudioPath);
			if (audioFile instanceof TFile) {
				await this.app.fileManager.trashFile(audioFile);
			}

			if (result.failedStepIndex !== undefined) {
				const failedStep = STEP_NAMES[result.failedStepIndex] ?? 'unknown';
				return { success: false, error: 'Pipeline step failed', failedStep };
			}

			const transcriptPreview = result.context.transcriptionResult?.fullText
				? result.context.transcriptionResult.fullText.substring(0, 100)
				: '';

			return {
				success: true,
				transcriptPreview,
				noteFilePath: result.context.noteFilePath,
			};
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			logger.error(COMPONENT, 'Test recording failed', { error });
			return { success: false, error, failedStep: 'recording' };
		}
	}

	private async updateParticipantNames(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('No active file — open a meeting note first');
			return;
		}

		try {
			const content = await this.app.vault.read(activeFile);
			const parsed = parseFrontmatter(content);
			if (!parsed) {
				new Notice('No frontmatter found in this note');
				return;
			}

			if (!parsed.frontmatter.includes('created_by: meeting-scribe') &&
				!parsed.frontmatter.includes('transcript_data:')) {
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- product name
			new Notice('This note was not created by Meeting Scribe');
				return;
			}

			const participants = parseParticipantsFromYaml(parsed.frontmatter);
			if (!participants) {
				if (/^participants:/m.test(parsed.frontmatter)) {
					new Notice('This note uses an older format — re-generate to use participant aliases');
				} else {
					new Notice('No participant mappings found in this note');
				}
				return;
			}

			const hasNames = participants.some(p => p.name !== '');
			if (!hasNames) {
				new Notice('Fill in participant names first, then run this command again');
				return;
			}

			// Apply replacements to meeting note
			const noteResult = applyParticipantReplacements(content, participants);
			await this.app.vault.modify(activeFile, noteResult.updatedContent);
			let totalReplacements = noteResult.replacementCount;

			// Apply replacements to transcript file if linked
			const transcriptMatch = parsed.frontmatter.match(/transcript:\s*['"]?\[\[(.+?)\]\]['"]?\s*$/m);
			if (transcriptMatch) {
				const transcriptName = transcriptMatch[1]!;
				const transcriptPath = `${activeFile.parent?.path ?? ''}/${transcriptName}.md`;
				const transcriptFile = this.app.vault.getAbstractFileByPath(transcriptPath);

				if (transcriptFile instanceof TFile) {
					const transcriptContent = await this.app.vault.read(transcriptFile);
					const transcriptResult = applyParticipantReplacements(transcriptContent, participants);
					await this.app.vault.modify(transcriptFile, transcriptResult.updatedContent);
					totalReplacements += transcriptResult.replacementCount;
				}
			}

			new Notice(`Participant names updated (${totalReplacements} replacements)`);
			logger.info(COMPONENT, 'Participant names updated', { replacements: totalReplacements });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(COMPONENT, 'Failed to update participant names', { error: message });
			new Notice('Failed to update participant names');
		}
	}

	private getActiveSidebarView(): TranscriptSidebarView | null {
		const leaves = this.app.workspace.getLeavesOfType(TranscriptSidebarView.VIEW_TYPE);
		if (leaves.length > 0) {
			return leaves[0]!.view as TranscriptSidebarView;
		}
		return null;
	}

	private async activateSidebarView(): Promise<TranscriptSidebarView | null> {
		const existing = this.app.workspace.getLeavesOfType(TranscriptSidebarView.VIEW_TYPE);
		if (existing.length > 0) {
			void this.app.workspace.revealLeaf(existing[0]!);
			return existing[0]!.view as TranscriptSidebarView;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: TranscriptSidebarView.VIEW_TYPE, active: true });
			void this.app.workspace.revealLeaf(leaf);
			return leaf.view as TranscriptSidebarView;
		}
		return null;
	}

	private async handleMeetingNoteOpened(notePath: string, transcriptDataPath?: string): Promise<void> {
		try {
			const sidebarView = await this.activateSidebarView();
			if (sidebarView) {
				if (transcriptDataPath) {
					await sidebarView.showTranscriptForTranscriptFile(transcriptDataPath);
				} else {
					await sidebarView.showTranscriptForNote(notePath);
				}
			}
		} catch (err) {
			logger.error(COMPONENT, 'Failed to auto-open sidebar', {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	onunload() {
		this.pipelineAborted = true;
		this.dispatcher?.abortAll();
		this.ribbonHandler?.destroy();
		this.statusBar?.destroy();
		this.recorder?.destroy();
		logger.debug(COMPONENT, 'Plugin unloaded');
	}
}
