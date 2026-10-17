// workflow/identity/app.js: the workkit-agent GitHub App's three constants, the
// one home every other part of the kit reads them from.
// Usage: const { CLIENT_ID, INSTALL_URL, TOKEN_URL } = require('./app');

// The App's Client ID, under About on its General page: a public value, the
// device flow's client_id.
const CLIENT_ID = 'Iv23li6ol4u1zBCn9bEz';
// Where an owner installs the App on a repo, the page a not-installed refusal names.
const INSTALL_URL = 'https://github.com/apps/workkit-agent';
// The hosted token service; `identity.tokenUrl` in ~/.workkit/settings.json overrides it.
const TOKEN_URL = 'https://workkit.itwcreativeworks.com/token';

module.exports = { CLIENT_ID, INSTALL_URL, TOKEN_URL };
