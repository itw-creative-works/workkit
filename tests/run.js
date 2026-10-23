#!/usr/bin/env node
// This repo's `npm test`: the kit's runner over this repo, reached by a relative
// path so a bare checkout runs it. The runner and its contract: workflow/test/run.js.

const path = require('path');

require('../workflow/test/run.js').main(['--root', path.dirname(__dirname), ...process.argv.slice(2)]);
