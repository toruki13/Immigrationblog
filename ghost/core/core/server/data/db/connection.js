const _ = require('lodash');
const knex = require('knex');
const os = require('os');

const logging = require('@tryghost/logging');
const config = require('../../../shared/config');
const errors = require('@tryghost/errors');

/** @type {knex.Knex} */
let knexInstance;

function shouldEnableDefaultPgSsl(connectionString) {
    try {
        const parsed = new URL(connectionString);
        const sslMode = parsed.searchParams.get('sslmode');

        if (sslMode === 'disable') {
            return false;
        }

        return !['localhost', '127.0.0.1', '::1', 'postgres'].includes(parsed.hostname);
    } catch (err) {
        return true;
    }
}

// @TODO:
// - if you require this file before config file was loaded,
// - then this file is cached and you have no chance to connect to the db anymore
// - bring dynamic into this file (db.connect())
function configure(dbConfig) {
    const client = dbConfig.client;

    if (client === 'mysql' || client === 'mysql2') {
        throw new errors.InternalServerError({
            message: 'MySQL is no longer supported in this fork. Configure database.client as "pg".'
        });
    }

    if (client === 'sqlite3') {
        // Backwards compatibility with old knex behaviour
        dbConfig.useNullAsDefault = Object.prototype.hasOwnProperty.call(dbConfig, 'useNullAsDefault') ? dbConfig.useNullAsDefault : true;

        // Enables foreign key checks and delete on cascade
        dbConfig.pool = {
            afterCreate(conn, cb) {
                conn.run('PRAGMA foreign_keys = ON', cb);

                // These two are meant to improve performance at the cost of reliability
                // Should be safe for tests. We add them here and leave them on
                if (config.get('env').startsWith('testing')) {
                    conn.run('PRAGMA synchronous = OFF;');
                    conn.run('PRAGMA journal_mode = TRUNCATE;');
                }
            }
        };

        // In the default SQLite test config we set the path to /tmp/ghost-test.db,
        // but this won't work on Windows, so we need to replace the /tmp bit with
        // the Windows temp folder
        const filename = dbConfig.connection.filename;
        if (process.platform === 'win32' && _.isString(filename) && filename.match(/^\/tmp/)) {
            dbConfig.connection.filename = filename.replace(/^\/tmp/, os.tmpdir());
            logging.info(`Ghost DB path: ${dbConfig.connection.filename}`);
        }
    }

    if (client === 'pg') {
        const existingConnection = typeof dbConfig.connection === 'object' ? dbConfig.connection : {};

        // Railway provides DATABASE_URL as a connection string
        if (process.env.DATABASE_URL) {
            dbConfig.connection = {
                ...existingConnection,
                connectionString: process.env.DATABASE_URL
            };

            if (dbConfig.connection.ssl === undefined && shouldEnableDefaultPgSsl(process.env.DATABASE_URL)) {
                dbConfig.connection.ssl = {rejectUnauthorized: false};
            }
        }

        // Normalize SSL config when it is explicitly enabled or provided.
        if (typeof dbConfig.connection === 'object') {
            if (dbConfig.connection.ssl === true) {
                dbConfig.connection.ssl = {rejectUnauthorized: false};
            } else if (dbConfig.connection.ssl && typeof dbConfig.connection.ssl === 'object') {
                dbConfig.connection.ssl = {
                    rejectUnauthorized: false,
                    ...dbConfig.connection.ssl
                };
            }
        }

        dbConfig.searchPath = ['public'];
    }

    if (client !== 'sqlite3' && client !== 'pg') {
        throw new errors.InternalServerError({
            message: `Unsupported database client "${client}". Supported clients are "pg" and "sqlite3".`
        });
    }

    return dbConfig;
}

if (!knexInstance && config.get('database') && config.get('database').client) {
    knexInstance = knex(configure(config.get('database')));
}

module.exports = knexInstance;
