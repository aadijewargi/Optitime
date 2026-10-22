'use strict';

const path = require('path');
const { Store } = require('./src/store');
const { createApp } = require('./src/app');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');

const store = new Store(DATA_FILE);
const app = createApp(store);

app.listen(PORT, () => {
  console.log(`Focus Forward running at http://localhost:${PORT}`);
});
