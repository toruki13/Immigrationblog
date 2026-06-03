// `environment` is part of the public signature (callers/tests pass it) but the
// warning currently depends only on the database engine, so it is intentionally
// unused. Prefixed with `_` so tsc's noUnusedParameters does not flag it.
export function showDatabaseWarning(_environment: string, database: string): boolean {
    return database !== 'pg';
}
