export function showDatabaseWarning(environment: string, database:string) : boolean {
    return database !== 'pg';
}
