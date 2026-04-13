const assert = require('node:assert/strict');
const sinon = require('sinon');
const testUtils = require('../../utils');
const dbUtils = require('../../utils/db-utils');
const logging = require('@tryghost/logging');

const utils = require('../../../core/server/data/migrations/utils');
const db = require('../../../core/server/data/db');

describe('Migrations - schema utils', function () {
    const tableName = 'test_nullable_integration';

    before(async function () {
        await testUtils.startGhost();
    });

    beforeEach(async function () {
        // Clean up any existing test tables first
        const knex = db.knex;
        
        if (await knex.schema.hasTable(tableName)) {
            await knex.schema.dropTable(tableName);
        }
        if (await knex.schema.hasTable('test_foreign_table')) {
            await knex.schema.dropTable('test_foreign_table');
        }

        // Create a second table for foreign key testing first
        await knex.schema.createTable('test_foreign_table', function (table) {
            table.increments('id');
            table.string('name');
        });

        await knex.schema.createTable(tableName, function (table) {
            table.increments('id');
            table.string('nullable_col').nullable();
            table.string('not_nullable_col').notNullable();
            table.string('mixed_col').notNullable();
            table.string('with_default').notNullable().defaultTo('default');
            table.integer('foreign_key_col').unsigned();
        });

        // Note: We're not adding actual foreign key constraints in these tests
        // because database limitations with modifying columns that have foreign keys.
        // The tests verify basic nullable column operations work correctly.

        // Insert test data
        await knex('test_foreign_table').insert({id: 1, name: 'test'});
        await knex(tableName).insert({
            nullable_col: 'test',
            not_nullable_col: 'required',
            mixed_col: 'data',
            with_default: 'custom',
            foreign_key_col: 1
        });
    });

    afterEach(async function () {
        const knex = db.knex;

        // Drop tables in correct order
        if (await knex.schema.hasTable(tableName)) {
            await knex.schema.dropTable(tableName);
        }

        if (await knex.schema.hasTable('test_foreign_table')) {
            await knex.schema.dropTable('test_foreign_table');
        }

        sinon.restore();
    });

    async function isColumnNullable(table, column) {
        const knex = db.knex;

        if (dbUtils.isSQLite()) {
            const response = await knex.raw('PRAGMA table_info(??)', [table]);
            const columnInfo = response.find(col => col.name === column);
            return columnInfo && columnInfo.notnull === 0;
        } else {
            // PostgreSQL
            const response = await knex.raw(
                `SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
                [table, column]
            );
            const columnInfo = response.rows[0];
            return columnInfo && columnInfo.is_nullable === 'YES';
        }
    }

    async function isColumnNotNullable(table, column) {
        const knex = db.knex;

        if (dbUtils.isSQLite()) {
            const response = await knex.raw('PRAGMA table_info(??)', [table]);
            const columnInfo = response.find(col => col.name === column);
            return columnInfo && columnInfo.notnull === 1;
        } else {
            // PostgreSQL
            const response = await knex.raw(
                `SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
                [table, column]
            );
            const columnInfo = response.rows[0];
            return columnInfo && columnInfo.is_nullable === 'NO';
        }
    }

    describe('createSetNullableMigration', function () {
        it('Sets a not-nullable column to nullable', async function () {
            const migration = utils.createSetNullableMigration(tableName, 'not_nullable_col');

            // Verify initial state
            const isNotNullableInitial = await isColumnNotNullable(tableName, 'not_nullable_col');
            assert.equal(isNotNullableInitial, true, 'Column should initially be not nullable');

            // Run up migration
            const transacting = await db.knex.transaction();
            await migration.up({transacting});
            await transacting.commit();

            // Verify column is now nullable
            const isNullableAfter = await isColumnNullable(tableName, 'not_nullable_col');
            assert.equal(isNullableAfter, true, 'Column should be nullable after up migration');

            // Run down migration with foreign key checks disabled
            const transactingDown = await db.knex.transaction();
            await migration.down({transacting: transactingDown});
            await transactingDown.commit();

            // Verify column is not nullable again
            const isNotNullableAfterDown = await isColumnNotNullable(tableName, 'not_nullable_col');
            assert.equal(isNotNullableAfterDown, true, 'Column should be not nullable after down migration');
        });

        it('Skips setting nullable when column is already nullable', async function () {
            const migration = utils.createSetNullableMigration(tableName, 'nullable_col');
            const logSpy = sinon.spy(logging, 'warn');

            // Verify initial state
            const isNullableInitial = await isColumnNullable(tableName, 'nullable_col');
            assert.equal(isNullableInitial, true, 'Column should initially be nullable');

            // Run up migration
            const transacting = await db.knex.transaction();
            await migration.up({transacting});
            await transacting.commit();

            sinon.assert.calledWith(logSpy, sinon.match('skipping as column is already nullable'));

            // Column should still be nullable
            const isNullableAfter = await isColumnNullable(tableName, 'nullable_col');
            assert.equal(isNullableAfter, true, 'Column should still be nullable');
        });

        it('Handles dropNullable migration correctly', async function () {
            // This test verifies that dropNullable works correctly
            const migration = utils.createDropNullableMigration(tableName, 'nullable_col');

            // Verify initial state
            const isNullableInitial = await isColumnNullable(tableName, 'nullable_col');
            assert.equal(isNullableInitial, true, 'Column should initially be nullable');

            // Run up migration
            const transacting = await db.knex.transaction();
            await migration.up({transacting});
            await transacting.commit();

            // Verify column is now not nullable
            const isNotNullableAfter = await isColumnNotNullable(tableName, 'nullable_col');
            assert.equal(isNotNullableAfter, true, 'Column should be not nullable after up migration');

            // Run down migration
            const transactingDown = await db.knex.transaction();
            await migration.down({transacting: transactingDown});
            await transactingDown.commit();

            // Verify column is nullable again
            const isNullableAfterDown = await isColumnNullable(tableName, 'nullable_col');
            assert.equal(isNullableAfterDown, true, 'Column should be nullable after down migration');
        });
    });

    describe('createDropNullableMigration', function () {
        it('Drops nullable from a nullable column', async function () {
            const migration = utils.createDropNullableMigration(tableName, 'nullable_col');

            // Verify initial state
            const isNullableInitial = await isColumnNullable(tableName, 'nullable_col');
            assert.equal(isNullableInitial, true, 'Column should initially be nullable');

            // Run up migration
            const transacting = await db.knex.transaction();
            await migration.up({transacting});
            await transacting.commit();

            // Verify column is now not nullable
            const isNotNullableAfter = await isColumnNotNullable(tableName, 'nullable_col');
            assert.equal(isNotNullableAfter, true, 'Column should be not nullable after up migration');

            // Run down migration
            const transactingDown = await db.knex.transaction();
            await migration.down({transacting: transactingDown});
            await transactingDown.commit();

            // Verify column is nullable again
            const isNullableAfterDown = await isColumnNullable(tableName, 'nullable_col');
            assert.equal(isNullableAfterDown, true, 'Column should be nullable after down migration');
        });

        it('Skips dropping nullable when column is already not nullable', async function () {
            const migration = utils.createDropNullableMigration(tableName, 'not_nullable_col');
            const logSpy = sinon.spy(logging, 'warn');

            // Verify initial state
            const isNotNullableInitial = await isColumnNotNullable(tableName, 'not_nullable_col');
            assert.equal(isNotNullableInitial, true, 'Column should initially be not nullable');

            // Run up migration
            const transacting = await db.knex.transaction();
            await migration.up({transacting});
            await transacting.commit();

            sinon.assert.calledWith(logSpy, sinon.match('skipping as column is already not nullable'));

            // Column should still be not nullable
            const isNotNullableAfter = await isColumnNotNullable(tableName, 'not_nullable_col');
            assert.equal(isNotNullableAfter, true, 'Column should still be not nullable');
        });

        it('Drops nullable when column has data', async function () {
            // This test verifies that dropNullable works correctly with data in the column
            const testColumn = 'nullable_col';
            const migration = utils.createDropNullableMigration(tableName, testColumn);

            // Verify column is initially nullable
            const isNullableInitial = await isColumnNullable(tableName, testColumn);
            assert.equal(isNullableInitial, true, 'Column should be nullable before test');

            // Run up migration
            const transacting = await db.knex.transaction();
            await migration.up({transacting});
            await transacting.commit();

            // Verify column is not nullable
            const isNotNullableAfter = await isColumnNotNullable(tableName, testColumn);
            assert.equal(isNotNullableAfter, true, 'Column should be not nullable after up migration');
        });
    });

    describe('Database-specific edge cases', function () {
        it('Handles columns with default values correctly', async function () {
            // Test with a column that has a default value
            const migration = utils.createDropNullableMigration(tableName, 'with_default');

            // First make it nullable
            const setNullableMigration = utils.createSetNullableMigration(tableName, 'with_default');
            const transactingSetup = await db.knex.transaction();
            await setNullableMigration.up({transacting: transactingSetup});
            await transactingSetup.commit();

            // Run drop nullable migration
            const transacting = await db.knex.transaction();
            await migration.up({transacting});
            await transacting.commit();

            // Verify column is not nullable and still has its default
            const isNotNullable = await isColumnNotNullable(tableName, 'with_default');
            assert.equal(isNotNullable, true, 'Column should be not nullable');

            // Verify default value is preserved (PostgreSQL-specific check)
            if (dbUtils.isPostgreSQL()) {
                const response = await db.knex.raw(
                    `SELECT column_default FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
                    [tableName, 'with_default']
                );
                const columnInfo = response.rows[0];
                assert.ok(columnInfo.column_default, 'Column should still have its default value');
            }
        });

        it('Handles non-existent table errors', async function () {
            const migration = utils.createSetNullableMigration('non_existent_table', 'some_column');
            const logWarnSpy = sinon.spy(logging, 'warn');

            let transacting;
            let errorThrown = false;
            let errorMessage = '';
            try {
                transacting = await db.knex.transaction();
                await migration.up({transacting});
                await transacting.commit();
            } catch (error) {
                errorThrown = true;
                errorMessage = error.message;
                // Expected to fail when actually trying to alter the non-existent table
                if (transacting && !transacting.isCompleted()) {
                    await transacting.rollback();
                }
            }

            // The behavior differs between databases:
            // - PostgreSQL: information_schema query will fail for non-existent table, logging a warning
            // - SQLite: PRAGMA table_info returns empty result, no error until ALTER TABLE

            if (dbUtils.isPostgreSQL()) {
                // PostgreSQL should log a warning when checking nullable status fails
                sinon.assert.calledWith(logWarnSpy, sinon.match('Could not check nullable status'));
            }

            // Both databases should eventually fail when trying to ALTER the non-existent table
            assert(errorThrown, 'Should throw an error when trying to alter non-existent table');

            // The error message varies between databases and Knex versions
            const isExpectedError = errorMessage.match(/no such table|does not exist|doesn't exist|Table .* not found|relation .* does not exist/i) ||
                                  errorMessage.includes('Cannot read properties of undefined') ||
                                  errorMessage.includes('SQLITE_ERROR') ||
                                  errorMessage.includes('42P01');

            assert(isExpectedError, `Error should be related to missing table, but was: ${errorMessage}`);
        });
    });
});
