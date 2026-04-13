const {createDropNullableMigration} = require('../../utils');

module.exports = createDropNullableMigration('members', 'transient_id');
