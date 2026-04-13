const logging = require('@tryghost/logging');
const {commands} = require('../../schema');

const {createNonTransactionalMigration, createTransactionalMigration} = require('./migrations');

/**
 * @param {string} table
 * @param {string} column
 * @param {Object} columnDefinition
 *
 * @returns {Migration}
 */
function createAddColumnMigration(table, column, columnDefinition) {
    return createNonTransactionalMigration(
        // up
        commands.createColumnMigration({
            table,
            column,
            dbIsInCorrectState: hasColumn => hasColumn === true,
            operation: commands.addColumn,
            operationVerb: 'Adding',
            columnDefinition
        }),
        // down
        commands.createColumnMigration({
            table,
            column,
            dbIsInCorrectState: hasColumn => hasColumn === false,
            operation: commands.dropColumn,
            operationVerb: 'Removing',
            columnDefinition
        })
    );
}

/**
 * @param {string} table
 * @param {string} column
 * @param {Object} columnDefinition
 *
 * @returns {Migration}
 */
function createDropColumnMigration(table, column, columnDefinition) {
    return createNonTransactionalMigration(
        // up
        commands.createColumnMigration({
            table,
            column,
            dbIsInCorrectState: hasColumn => hasColumn === false,
            operation: commands.dropColumn,
            operationVerb: 'Removing',
            columnDefinition
        }),
        // down
        commands.createColumnMigration({
            table,
            column,
            dbIsInCorrectState: hasColumn => hasColumn === true,
            operation: commands.addColumn,
            operationVerb: 'Adding',
            columnDefinition
        })
    );
}

/**
 * @param {string} table
 * @param {string} column
 * @returns {Migration}
 */
function createSetNullableMigration(table, column) {
    return createTransactionalMigration(
        async function up(knex) {
            try {
                // Check if column is already nullable
                const isNullable = await isColumnNullable(table, column, knex);
                if (isNullable) {
                    logging.warn(`Setting nullable: ${table}.${column} - skipping as column is already nullable`);
                    return;
                }
            } catch (error) {
                // If we can't check the column status, proceed with the migration
                // This maintains backward compatibility with implementation before checks were added
                logging.warn(`Could not check nullable status for ${table}.${column}, proceeding with migration: ${error.message}`);
            }

            logging.info(`Setting nullable: ${table}.${column}`);
            await commands.setNullable(table, column, knex);
        },
        async function down(knex) {
            try {
                // Check if column is already not nullable
                const isNotNullable = await isColumnNotNullable(table, column, knex);
                if (isNotNullable) {
                    logging.warn(`Dropping nullable: ${table}.${column} - skipping as column is already not nullable`);
                    return;
                }
            } catch (error) {
                // If we can't check the column status, proceed with the migration
                // This maintains backward compatibility with implementation before checks were added
                logging.warn(`Could not check nullable status for ${table}.${column}, proceeding with migration: ${error.message}`);
            }

            logging.info(`Dropping nullable: ${table}.${column}`);
            await commands.dropNullable(table, column, knex);
        }
    );
}

/**
 * @param {string} table
 * @param {string[]|string} columns One or multiple columns (in case the index should be for multiple columns)
 * @returns {Migration}
 */
function createAddIndexMigration(table, columns) {
    return createTransactionalMigration(
        async function up(knex) {
            await commands.addIndex(table, columns, knex);
        },
        async function down(knex) {
            await commands.dropIndex(table, columns, knex);
        }
    );
}

/**
 * @param {string} table
 * @param {string} from
 * @param {string} to
 *
 * @returns {Migration}
 */
function createRenameColumnMigration(table, from, to) {
    return createNonTransactionalMigration(
        async function up(knex) {
            const hasColumn = await knex.schema.hasColumn(table, to);
            if (hasColumn) {
                logging.warn(`Renaming ${table}.${from} to ${table}.${to} column - skipping as column ${table}.${to} already exists`);
            } else {
                await commands.renameColumn(table, from, to, knex);
            }
        },
        async function down(knex) {
            const hasColumn = await knex.schema.hasColumn(table, from);
            if (hasColumn) {
                logging.warn(`Renaming ${table}.${to} to ${table}.${from} column - skipping as column ${table}.${from} already exists`);
            } else {
                await commands.renameColumn(table, to, from, knex);
            }
        }
    );
}

/**
 * Check if a column is already not nullable
 * @param {string} table
 * @param {string} column
 * @param {import('knex').Knex} knex
 * @returns {Promise<boolean>}
 */
async function isColumnNotNullable(table, column, knex) {
    const client = knex.client.config.client;

    if (client === 'sqlite3') {
        const response = await knex.raw('PRAGMA table_info(??)', [table]);
        const columnInfo = response.find(col => col.name === column);
        return columnInfo && columnInfo.notnull === 1;
    } else if (client === 'pg') {
        const response = await knex.raw(
            `SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
            [table, column]
        );
        const columnInfo = response.rows[0];
        return columnInfo && columnInfo.is_nullable === 'NO';
    }

    return false;
}

/**
 * Check if a column is already nullable
 * @param {string} table
 * @param {string} column
 * @param {import('knex').Knex} knex
 * @returns {Promise<boolean>}
 */
async function isColumnNullable(table, column, knex) {
    const client = knex.client.config.client;

    if (client === 'sqlite3') {
        const response = await knex.raw('PRAGMA table_info(??)', [table]);
        const columnInfo = response.find(col => col.name === column);
        return columnInfo && columnInfo.notnull === 0;
    } else if (client === 'pg') {
        const response = await knex.raw(
            `SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
            [table, column]
        );
        const columnInfo = response.rows[0];
        return columnInfo && columnInfo.is_nullable === 'YES';
    }

    return false;
}

/**
 * @param {string} table
 * @param {string} column
 * @returns {Migration}
 */
function createDropNullableMigration(table, column) {
    return createTransactionalMigration(
        async function up(knex) {
            try {
                // Check if column is already not nullable
                const isNotNullable = await isColumnNotNullable(table, column, knex);
                if (isNotNullable) {
                    logging.warn(`Dropping nullable: ${table}.${column} - skipping as column is already not nullable`);
                    return;
                }
            } catch (error) {
                // If we can't check the column status, proceed with the migration
                // This maintains backward compatibility with implementation before checks were added
                logging.warn(`Could not check nullable status for ${table}.${column}, proceeding with migration: ${error.message}`);
            }

            logging.info(`Dropping nullable: ${table}.${column}`);
            await commands.dropNullable(table, column, knex);
        },
        async function down(knex) {
            try {
                // Check if column is already nullable
                const isNullable = await isColumnNullable(table, column, knex);
                if (isNullable) {
                    logging.warn(`Setting nullable: ${table}.${column} - skipping as column is already nullable`);
                    return;
                }
            } catch (error) {
                // If we can't check the column status, proceed with the migration
                // This maintains backward compatibility with implementation before checks were added
                logging.warn(`Could not check nullable status for ${table}.${column}, proceeding with migration: ${error.message}`);
            }

            logging.info(`Setting nullable: ${table}.${column}`);
            await commands.setNullable(table, column, knex);
        }
    );
}

module.exports = {
    createAddColumnMigration,
    createDropColumnMigration,
    createSetNullableMigration,
    createDropNullableMigration,
    createRenameColumnMigration,
    createAddIndexMigration
};

/**
 * @typedef {Object} TransactionalMigrationFunctionOptions
 *
 * @prop {import('knex').Knex} transacting
 */

/**
 * @typedef {(options: TransactionalMigrationFunctionOptions) => Promise<void>} TransactionalMigrationFunction
 */

/**
 * @typedef {Object} Migration
 *
 * @prop {Object} config
 * @prop {boolean} config.transaction
 *
 * @prop {TransactionalMigrationFunction} up
 * @prop {TransactionalMigrationFunction} down
 */
