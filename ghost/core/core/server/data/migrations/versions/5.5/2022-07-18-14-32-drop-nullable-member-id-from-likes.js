const {createDropNullableMigration} = require('../../utils');

module.exports = createDropNullableMigration('comment_likes', 'member_id');
