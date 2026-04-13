const {createSetNullableMigration} = require('../../utils');

module.exports = createSetNullableMigration('stripe_products', 'product_id');
