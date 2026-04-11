import Docker from 'dockerode';
import baseDebug from '@tryghost/debug';
import logging from '@tryghost/logging';
import {DEV_PRIMARY_DATABASE} from '@/helpers/environment/constants';
import {PassThrough} from 'stream';
import {randomUUID} from 'crypto';
import type {Container} from 'dockerode';

const debug = baseDebug('e2e:PostgresManager');

interface ContainerWithModem extends Container {
    modem: {
        demuxStream(stream: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): void;
    };
}

/**
 * Manages PostgreSQL operations for E2E tests.
 * Handles creating snapshots, creating/restoring/dropping databases, and
 * updating database settings needed by tests.
 */
export class PostgresManager {
    private readonly docker: Docker;
    private readonly containerName: string;
    private readonly host: string;
    private readonly port: number;
    private readonly user: string;
    private readonly password: string;

    constructor(containerName: string = 'ghost-dev-postgres') {
        this.docker = new Docker();
        this.containerName = containerName;
        this.host = process.env.PGHOST || '127.0.0.1';
        this.port = parseInt(process.env.PGPORT || '5432', 10);
        this.user = process.env.PGUSER || 'ghost';
        this.password = process.env.PGPASSWORD || 'ghost';
    }

    async setupTestDatabase(databaseName: string, siteUuid: string, options: {
        stripe?: {
            secretKey: string;
            publishableKey: string;
        };
    } = {}): Promise<void> {
        debug('Setting up test database:', databaseName);
        try {
            await this.createDatabase(databaseName);
            await this.restoreDatabaseFromSnapshot(databaseName);
            await this.updateSiteUuid(databaseName, siteUuid);
            if (options.stripe) {
                await this.updateStripeSettings(databaseName, options.stripe.secretKey, options.stripe.publishableKey);
            }

            debug('Test database setup completed:', databaseName, 'with site_uuid:', siteUuid);
        } catch (error) {
            logging.error('Failed to setup test database:', error);
            throw error instanceof Error ? error : new Error(`Failed to setup test database: ${String(error)}`);
        }
    }

    async cleanupTestDatabase(databaseName: string): Promise<void> {
        try {
            await this.dropDatabase(databaseName);
            debug('Test database cleanup completed:', databaseName);
        } catch (error) {
            // Don't throw - cleanup failures shouldn't break tests
            logging.warn('Failed to cleanup test database:', error);
        }
    }

    async createDatabase(databaseName: string): Promise<void> {
        this.assertSafeDatabaseName(databaseName);
        debug('Creating database:', databaseName);

        await this.execPsql(`CREATE DATABASE "${databaseName}"`, 'postgres');

        debug('Database created:', databaseName);
    }

    async dropDatabase(databaseName: string): Promise<void> {
        this.assertSafeDatabaseName(databaseName);
        debug('Dropping database if exists:', databaseName);

        await this.terminateConnections(databaseName);
        await this.execPsql(`DROP DATABASE IF EXISTS "${databaseName}"`, 'postgres');

        debug('Database dropped (if existed):', databaseName);
    }

    async dropDatabases(databaseNames: string[]): Promise<void> {
        for (const databaseName of databaseNames) {
            await this.dropDatabase(databaseName);
        }

        debug('All test databases cleaned up');
    }

    /**
     * Used for cleanup of leftover databases from interrupted tests.
     * This removes all databases matching the pattern 'ghost_%' except base databases.
     */
    async dropAllTestDatabases(): Promise<void> {
        try {
            debug('Finding all test databases to clean up...');

            const query = `
                SELECT datname
                FROM pg_database
                WHERE datname LIKE 'ghost_%'
                  AND datname NOT IN ('ghost_testing', 'ghost_e2e_base', '${DEV_PRIMARY_DATABASE}')
            `;
            const output = await this.execPsql(query, 'postgres', {tuplesOnly: true});

            const databaseNames = this.parseDatabaseNames(output);
            if (databaseNames === null) {
                return;
            }

            await this.dropDatabases(databaseNames);
        } catch (error) {
            // Don't throw - we want to continue with setup even if PostgreSQL cleanup fails
            debug('Failed to clean up test databases (PostgreSQL may not be running):', error);
        }
    }

    async createSnapshot(sourceDatabase: string = 'ghost_testing', outputPath: string = '/tmp/ghost-e2e-base.dump'): Promise<void> {
        this.assertSafeDatabaseName(sourceDatabase);
        logging.info('Creating database snapshot...');

        await this.exec(this.buildPgDumpCommand(sourceDatabase, outputPath));

        logging.info('Database snapshot created');
    }

    async deleteSnapshot(snapshotPath: string = '/tmp/ghost-e2e-base.dump'): Promise<void> {
        try {
            debug('Deleting PostgreSQL snapshot:', snapshotPath);

            await this.exec(`rm -f ${this.shellEscape(snapshotPath)}`);

            debug('PostgreSQL snapshot deleted');
        } catch (error) {
            // Don't throw - we want to continue with setup even if snapshot deletion fails
            debug('Failed to delete PostgreSQL snapshot (PostgreSQL may not be running):', error);
        }
    }

    async restoreDatabaseFromSnapshot(databaseName: string, snapshotPath: string = '/tmp/ghost-e2e-base.dump'): Promise<void> {
        this.assertSafeDatabaseName(databaseName);
        debug('Restoring database from snapshot:', databaseName);

        await this.exec(this.buildPgRestoreCommand(databaseName, snapshotPath));

        debug('Database restored from snapshot:', databaseName);
    }

    async recreateBaseDatabase(databaseName: string = 'ghost_testing'): Promise<void> {
        debug('Recreating base database:', databaseName);

        await this.dropDatabase(databaseName);
        await this.createDatabase(databaseName);

        debug('Base database recreated:', databaseName);
    }

    async updateSiteUuid(databaseName: string, siteUuid: string): Promise<void> {
        this.assertSafeDatabaseName(databaseName);
        debug('Updating site_uuid in database settings:', databaseName, siteUuid);

        const sql = `
            UPDATE settings
            SET value = ${this.sqlLiteral(siteUuid)},
                updated_at = CURRENT_TIMESTAMP
            WHERE "key" = 'site_uuid'
        `;

        await this.execPsql(sql, databaseName);

        debug('site_uuid updated in database settings:', siteUuid);
    }

    async updateStripeSettings(databaseName: string, secretKey: string, publishableKey: string): Promise<void> {
        this.assertSafeDatabaseName(databaseName);
        debug('Updating Stripe settings in database:', databaseName);

        const secretSettingId = randomUUID().replace(/-/g, '').slice(0, 24);
        const publishableSettingId = randomUUID().replace(/-/g, '').slice(0, 24);

        const sql = `
            UPDATE settings
            SET value = ${this.sqlLiteral(secretKey)},
                updated_at = CURRENT_TIMESTAMP
            WHERE "key" = 'stripe_secret_key';

            INSERT INTO settings (id, "group", "key", value, type, flags, created_at, updated_at)
            SELECT ${this.sqlLiteral(secretSettingId)}, 'members', 'stripe_secret_key', ${this.sqlLiteral(secretKey)}, 'string', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (
                SELECT 1
                FROM settings
                WHERE "key" = 'stripe_secret_key'
            );

            UPDATE settings
            SET value = ${this.sqlLiteral(publishableKey)},
                updated_at = CURRENT_TIMESTAMP
            WHERE "key" = 'stripe_publishable_key';

            INSERT INTO settings (id, "group", "key", value, type, flags, created_at, updated_at)
            SELECT ${this.sqlLiteral(publishableSettingId)}, 'members', 'stripe_publishable_key', ${this.sqlLiteral(publishableKey)}, 'string', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (
                SELECT 1
                FROM settings
                WHERE "key" = 'stripe_publishable_key'
            );
        `;

        await this.execPsql(sql, databaseName);

        debug('Stripe settings updated in database');
    }

    private async terminateConnections(databaseName: string): Promise<void> {
        const sql = `
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = ${this.sqlLiteral(databaseName)}
              AND pid <> pg_backend_pid()
        `;

        await this.execPsql(sql, 'postgres');
    }

    private parseDatabaseNames(text: string) {
        if (!text.trim()) {
            debug('No test databases found to clean up');
            return null;
        }

        const databaseNames = text.trim().split('\n').filter(db => db.trim());

        if (databaseNames.length === 0) {
            debug('No test databases found to clean up');
            return null;
        }

        debug(`Found ${databaseNames.length} test database(s) to clean up:`, databaseNames);

        return databaseNames;
    }

    private assertSafeDatabaseName(databaseName: string): void {
        if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
            throw new Error(`Unsafe database name: ${databaseName}`);
        }
    }

    private sqlLiteral(value: string): string {
        return `'${value.replace(/'/g, '\'\'')}'`;
    }

    private shellEscape(value: string): string {
        return `'${value.replace(/'/g, `'"'"'`)}'`;
    }

    private buildPsqlCommand(databaseName: string, sql: string, options: {
        tuplesOnly?: boolean;
    } = {}): string {
        const tuplesOnly = options.tuplesOnly ? '-At ' : '';

        return [
            `PGPASSWORD=${this.shellEscape(this.password)}`,
            'psql',
            '-X',
            '-v',
            'ON_ERROR_STOP=1',
            '-h',
            this.shellEscape(this.host),
            '-p',
            this.shellEscape(String(this.port)),
            '-U',
            this.shellEscape(this.user),
            '-d',
            this.shellEscape(databaseName),
            tuplesOnly.trim(),
            '-c',
            this.shellEscape(sql)
        ].filter(Boolean).join(' ');
    }

    private buildPgDumpCommand(databaseName: string, outputPath: string): string {
        return [
            `PGPASSWORD=${this.shellEscape(this.password)}`,
            'pg_dump',
            '-h',
            this.shellEscape(this.host),
            '-p',
            this.shellEscape(String(this.port)),
            '-U',
            this.shellEscape(this.user),
            '-d',
            this.shellEscape(databaseName),
            '--format=custom',
            '--no-owner',
            '--no-privileges',
            '--file',
            this.shellEscape(outputPath)
        ].join(' ');
    }

    private buildPgRestoreCommand(databaseName: string, snapshotPath: string): string {
        return [
            `PGPASSWORD=${this.shellEscape(this.password)}`,
            'pg_restore',
            '-h',
            this.shellEscape(this.host),
            '-p',
            this.shellEscape(String(this.port)),
            '-U',
            this.shellEscape(this.user),
            '-d',
            this.shellEscape(databaseName),
            '--clean',
            '--if-exists',
            '--no-owner',
            '--no-privileges',
            this.shellEscape(snapshotPath)
        ].join(' ');
    }

    private async execPsql(sql: string, databaseName: string, options: {
        tuplesOnly?: boolean;
    } = {}): Promise<string> {
        return this.exec(this.buildPsqlCommand(databaseName, sql, options));
    }

    private async exec(command: string): Promise<string> {
        const container = this.docker.getContainer(this.containerName);
        return this.execInContainer(container, command);
    }

    /**
     * Execute a command in a container and wait for completion
     *
     * This is primarily needed to run CLI commands like pg_dump inside the container
     *
     * Dockerode's exec API is a bit low-level and requires some boilerplate to handle the streams
     * and detect errors, so we encapsulate that complexity here.
     *
     * @param container - The Docker container to execute the command in
     * @param command - The shell command to execute
     * @returns The command output
     * @throws Error if the command fails
     */
    private async execInContainer(container: Container, command: string): Promise<string> {
        const exec = await container.exec({
            Cmd: ['sh', '-c', command],
            AttachStdout: true,
            AttachStderr: true,
            Tty: false
        });

        const stream = await exec.start({
            hijack: true,
            stdin: false
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        const stdoutStream = new PassThrough();
        const stderrStream = new PassThrough();

        stdoutStream.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
        stderrStream.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

        (container as ContainerWithModem).modem.demuxStream(stream, stdoutStream, stderrStream);

        await new Promise<void>((resolve, reject) => {
            stream.on('end', () => resolve());
            stream.on('error', reject);
        });

        const execInfo = await exec.inspect();
        const exitCode = execInfo.ExitCode;

        const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

        if (exitCode !== 0) {
            throw new Error(
                `Command failed with exit code ${exitCode}: ${command}\n` +
                `STDOUT: ${stdout}\n` +
                `STDERR: ${stderr}`
            );
        }

        return stdout;
    }
}
