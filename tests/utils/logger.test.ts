import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, Logger } from '../../src/utils/logger';

describe('Logger', () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		logger.setDebugMode(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('debug()', () => {
		it('should suppress debug output when debugMode is false', () => {
			logger.debug('TestComponent', 'test message');
			expect(debugSpy).not.toHaveBeenCalled();
		});

		it('should output when debugMode is true', () => {
			logger.setDebugMode(true);
			logger.debug('TestComponent', 'test message');
			expect(debugSpy).toHaveBeenCalled();
		});

		it('should include component name and message in output', () => {
			logger.setDebugMode(true);
			logger.debug('Pipeline', 'STT started');
			const output = debugSpy.mock.calls[0]?.join(' ') ?? '';
			expect(output).toContain('Pipeline');
			expect(output).toContain('STT started');
		});

		it('should include context when provided', () => {
			logger.setDebugMode(true);
			logger.debug('Pipeline', 'STT started', { provider: 'openai' });
			const call = debugSpy.mock.calls[0];
			expect(call).toBeDefined();
			const hasContext = call?.some((arg: unknown) =>
				typeof arg === 'object' && arg !== null && 'provider' in arg
			);
			expect(hasContext).toBe(true);
		});
	});

	describe('info()', () => {
		it('should always output regardless of debugMode', () => {
			logger.info('Settings', 'settings loaded');
			// info uses console.debug due to ESLint no-console rule (only debug/warn/error allowed)
			expect(debugSpy).toHaveBeenCalled();
		});

		it('should include component name and message', () => {
			logger.info('Settings', 'settings loaded');
			const output = debugSpy.mock.calls[0]?.join(' ') ?? '';
			expect(output).toContain('Settings');
			expect(output).toContain('settings loaded');
		});
	});

	describe('warn()', () => {
		it('should always output regardless of debugMode', () => {
			logger.warn('Recorder', 'low disk space');
			expect(warnSpy).toHaveBeenCalled();
		});

		it('should include component name and message', () => {
			logger.warn('Recorder', 'low disk space');
			const output = warnSpy.mock.calls[0]?.join(' ') ?? '';
			expect(output).toContain('Recorder');
			expect(output).toContain('low disk space');
		});
	});

	describe('error()', () => {
		it('should always output regardless of debugMode', () => {
			logger.error('Pipeline', 'STT failed');
			expect(errorSpy).toHaveBeenCalled();
		});

		it('should include component name and message', () => {
			logger.error('Pipeline', 'STT failed');
			const output = errorSpy.mock.calls[0]?.join(' ') ?? '';
			expect(output).toContain('Pipeline');
			expect(output).toContain('STT failed');
		});

		it('should include context when provided', () => {
			logger.error('Pipeline', 'STT failed', { error: 'timeout', attempt: 2 });
			const call = errorSpy.mock.calls[0];
			expect(call).toBeDefined();
			const hasContext = call?.some((arg: unknown) =>
				typeof arg === 'object' && arg !== null && 'attempt' in arg
			);
			expect(hasContext).toBe(true);
		});
	});

	describe('setDebugMode()', () => {
		it('should enable debug output when set to true', () => {
			logger.setDebugMode(true);
			logger.debug('Test', 'message');
			expect(debugSpy).toHaveBeenCalled();
		});

		it('should disable debug output when set to false', () => {
			logger.setDebugMode(true);
			logger.setDebugMode(false);
			logger.debug('Test', 'message');
			expect(debugSpy).not.toHaveBeenCalled();
		});
	});

	describe('singleton', () => {
		it('should export a singleton instance', () => {
			expect(logger).toBeInstanceOf(Logger);
		});
	});
});
