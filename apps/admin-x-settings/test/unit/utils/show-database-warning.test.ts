import * as assert from 'assert/strict';
import {showDatabaseWarning} from '@src/utils/show-database-warning';

describe('showDatabaseWarning', function () {
    it('shows a warning when the database is not postgres in production', function () {
        assert.equal(showDatabaseWarning('production', 'sqlite3'), true);
    });

    it('shows a warning when the database is not postgres in development', function () {
        assert.equal(showDatabaseWarning('development', 'sqlite3'), true);
    });

    it('does not show a warning when in production and using postgres', function () {
        assert.equal(showDatabaseWarning('production', 'pg'), false);
    });

    it('does not show a warning when in development and using postgres', function () {
        assert.equal(showDatabaseWarning('development', 'pg'), false);
    });
});
