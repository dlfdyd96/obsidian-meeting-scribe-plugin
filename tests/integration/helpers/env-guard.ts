/**
 * Check if all required environment variables are set.
 * Use with `describe.skipIf(!hasEnvVars(...))` to skip integration tests gracefully.
 */
export function hasEnvVars(...vars: string[]): boolean {
	for (const v of vars) {
		if (!process.env[v]) {
			return false;
		}
	}
	return true;
}

/**
 * Get an environment variable value, throwing if not set.
 * Only call inside a describe block guarded by hasEnvVars().
 */
export function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Required environment variable ${name} is not set`);
	}
	return value;
}
