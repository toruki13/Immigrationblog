const logging = require('@tryghost/logging');
const DatabaseInfo = require('@tryghost/database-info');

const {createTransactionalMigration} = require('../../utils');

module.exports = createTransactionalMigration(
    async function up(knex) {
        logging.info('Adding verified property to sessions');

        if (DatabaseInfo.isMySQL(knex)) {
            await knex.raw(`
                UPDATE sessions
                SET session_data = JSON_SET(session_data, '$.verified', 'true')
                WHERE JSON_VALID(session_data);
            `);
        } else {
            // PostgreSQL: session_data is a text column containing JSON
            const sessions = await knex('sessions').select('id', 'session_data').whereNotNull('session_data');
            await sessions.reduce(async (previous, session) => {
                await previous;

                try {
                    const data = JSON.parse(session.session_data);
                    data.verified = 'true';
                    await knex('sessions').where('id', session.id).update({session_data: JSON.stringify(data)});
                } catch (e) {
                    // Skip invalid JSON
                }
            }, Promise.resolve());
        }
    },

    async function down(knex) {
        logging.info('Removing verified property from sessions');

        if (DatabaseInfo.isMySQL(knex)) {
            await knex.raw(`
                UPDATE sessions
                SET session_data = JSON_REMOVE(session_data, '$.verified')
                WHERE JSON_VALID(session_data);
            `);
        } else {
            const sessions = await knex('sessions').select('id', 'session_data').whereNotNull('session_data');
            await sessions.reduce(async (previous, session) => {
                await previous;

                try {
                    const data = JSON.parse(session.session_data);
                    delete data.verified;
                    await knex('sessions').where('id', session.id).update({session_data: JSON.stringify(data)});
                } catch (e) {
                    // Skip invalid JSON
                }
            }, Promise.resolve());
        }
    }
);
