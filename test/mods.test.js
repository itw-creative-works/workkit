// The kit's plugin tests, test/mods/*.test.ts, run as one case through `claude plugin test`.

const path = require('path');
const { modCase } = require('./lib/harness');

modCase(path.join(__dirname, '..'));
