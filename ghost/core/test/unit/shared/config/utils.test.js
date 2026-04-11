const assert = require('node:assert/strict');
const _ = require('lodash');
const configUtils = require('../../../../core/shared/config/utils');

let fakeConfig = {};
let fakeNconf = {};
let changedKey = [];

describe('Config Utils', function () {
    describe('makePathsAbsolute', function () {
        beforeEach(function () {
            changedKey = [];

            fakeNconf.get = (key) => {
                key = key.replace(':', '');
                return _.get(fakeConfig, key);
            };
            fakeNconf.set = function (key, value) {
                changedKey.push([key, value]);
            };
        });

        it('ensure we change paths only', function () {
            fakeConfig.database = {
                client: 'pg',
                connection: {
                    filename: 'content/data/ghost.db'
                }
            };

            configUtils.makePathsAbsolute(fakeNconf, fakeConfig.database, 'database');

            assert.equal(changedKey.length, 1);
            assert.equal(changedKey[0][0], 'database:connection:filename');
            assert.notEqual(changedKey[0][1], 'content/data/ghost.db');
        });

        it('ensure it skips non strings', function () {
            fakeConfig.database = {
                test: 10
            };

            configUtils.makePathsAbsolute(fakeNconf, fakeConfig.database, 'database');
            assert.equal(changedKey.length, 0);
        });

        it('ensure we don\'t change absolute paths', function () {
            fakeConfig.database = {
                client: 'pg',
                connection: {
                    filename: '/content/data/ghost.db'
                }
            };

            configUtils.makePathsAbsolute(fakeNconf, fakeConfig.database, 'database');
            assert.equal(changedKey.length, 0);
        });

        it('match paths on windows', function () {
            fakeConfig.database = {
                filename: 'content\\data\\ghost.db'

            };

            configUtils.makePathsAbsolute(fakeNconf, fakeConfig.database, 'database');
            assert.equal(changedKey.length, 1);
            assert.equal(changedKey[0][0], 'database:filename');
            assert.notEqual(changedKey[0][1], 'content\\data\\ghost.db');
        });
    });

    describe('sanitizeDatabaseProperties', function () {
        beforeEach(function () {
            fakeNconf.get = (key) => {
                return _.get(fakeConfig, key.replace(/:/g, '.'));
            };
            fakeNconf.set = function (key, value) {
                _.set(fakeConfig, key.replace(/:/g, '.'), value);
            };
        });

        it('throws if mysql is configured', function () {
            fakeConfig = {
                database: {
                    client: 'mysql',
                    connection: {}
                }
            };

            assert.throws(() => {
                configUtils.sanitizeDatabaseProperties(fakeNconf);
            }, /MySQL is no longer supported/);
        });

        it('preserves postgres connection fields and removes sqlite filename', function () {
            fakeConfig = {
                database: {
                    client: 'pg',
                    connection: {
                        host: '127.0.0.1',
                        port: 5433,
                        user: 'ghost',
                        password: 'ghost',
                        database: 'ghost_dev',
                        filename: '/tmp/ghost.db'
                    }
                }
            };

            configUtils.sanitizeDatabaseProperties(fakeNconf);

            assert.deepEqual(fakeConfig.database.connection, {
                host: '127.0.0.1',
                port: 5433,
                user: 'ghost',
                password: 'ghost',
                database: 'ghost_dev'
            });
        });
    });
});
