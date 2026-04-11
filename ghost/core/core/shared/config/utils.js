const path = require('path');
const fs = require('fs');
const jsonc = require('jsonc-parser');

/**
 * transform all relative paths to absolute paths
 * @TODO: re-write this function a little bit so we don't have to add the parent path - that is hard to understand
 *
 * Path must be string.
 * Path must match minimum one / or \
 * Path can be a "." to re-present current folder
 */
const makePathsAbsolute = function makePathsAbsolute(nconf, obj, parent) {
    Object.entries(obj).forEach(([pathsKey, configValue]) => {
        if (configValue && typeof configValue === 'object') {
            makePathsAbsolute(nconf, configValue, parent + ':' + pathsKey);
        } else if (
            typeof configValue === 'string' &&
            (configValue.match(/\/+|\\+/) || configValue === '.') &&
            !path.isAbsolute(configValue)
        ) {
            nconf.set(parent + ':' + pathsKey, path.normalize(path.join(__dirname, '../../..', configValue)));
        }
    });
};

const doesContentPathExist = function doesContentPathExist(contentPath) {
    if (!fs.existsSync(contentPath)) {
        // new Error is allowed here, as we do not want config to depend on @tryghost/error
        // @TODO: revisit this decision when @tryghost/error is no longer dependent on all of ghost-ignition
        // eslint-disable-next-line ghost/ghost-custom/no-native-error
        throw new Error('Your content path does not exist! Please double check `paths.contentPath` in your custom config file e.g. config.production.json.');
    }
};

/**
* Check if the URL in config has a protocol and sanitise it if not including a warning that it should be changed
*/
const checkUrlProtocol = function checkUrlProtocol(url) {
    if (!url.match(/^https?:\/\//i)) {
        // new Error is allowed here, as we do not want config to depend on @tryghost/error
        // @TODO: revisit this decision when @tryghost/error is no longer dependent on all of ghost-ignition
        // eslint-disable-next-line ghost/ghost-custom/no-native-error
        throw new Error('URL in config must be provided with protocol, eg. "http://my-ghost-blog.com"');
    }
};

const shouldEnableDefaultPgSsl = function shouldEnableDefaultPgSsl(connectionString) {
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
};

/**
 * nconf merges all database keys together and this can be confusing
 * e.g. production default database is sqlite, but you override the configuration with postgres
 *
 * this.clear('key') does not work
 * https://github.com/indexzero/nconf/issues/235#issuecomment-257606507
 */
const sanitizeDatabaseProperties = function sanitizeDatabaseProperties(nconf) {
    const client = nconf.get('database:client');

    if (client === 'mysql' || client === 'mysql2') {
        // new Error is allowed here, as we do not want config to depend on @tryghost/error
        // eslint-disable-next-line ghost/ghost-custom/no-native-error
        throw new Error('MySQL is no longer supported in this fork. Configure database.client as "pg".');
    }

    const database = nconf.get('database') || {};
    database.connection = database.connection || {};

    if (client === 'pg') {
        delete database.connection.filename;

        if (process.env.DATABASE_URL) {
            database.connection.connectionString = process.env.DATABASE_URL;

            if (database.connection.ssl === undefined && shouldEnableDefaultPgSsl(process.env.DATABASE_URL)) {
                database.connection.ssl = {rejectUnauthorized: false};
            }
        }
    } else {
        delete database.connection.host;
        delete database.connection.port;
        delete database.connection.user;
        delete database.connection.password;
        delete database.connection.database;
        delete database.connection.connectionString;
        delete database.connection.ssl;
    }

    nconf.set('database', database);

    if (client !== 'pg' && client !== 'sqlite3') {
        // new Error is allowed here, as we do not want config to depend on @tryghost/error
        // eslint-disable-next-line ghost/ghost-custom/no-native-error
        throw new Error(`Unsupported database client "${client}". Supported clients are "pg" and "sqlite3".`);
    }

    if (client === 'sqlite3') {
        makePathsAbsolute(nconf, nconf.get('database:connection'), 'database:connection');
    }
};

const getNodeEnv = () => {
    return process.env.NODE_ENV || 'development';
};

const jsoncFormat = {
    parse: function (text) {
        return jsonc.parse(text);
    },
    stringify: function (obj, replacer, spacing) {
        return JSON.stringify(obj, replacer, spacing);
    }
};

module.exports = {
    makePathsAbsolute,
    doesContentPathExist,
    checkUrlProtocol,
    sanitizeDatabaseProperties,
    getNodeEnv,
    jsoncFormat
};
