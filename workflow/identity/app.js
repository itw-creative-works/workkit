// workflow/identity/app.js: the workkit-agent GitHub App's two constants, the
// one home every other part of the kit reads them from; the token service's
// URL is the `identity.tokenUrl` setting, its default in defaults/settings.json.
// Usage: const { CLIENT_ID, INSTALL_URL } = require('./app');

// The App's Client ID, under About on its General page: a public value, the
// device flow's client_id.
const CLIENT_ID = 'Iv23li6ol4u1zBCn9bEz';
// Where an owner installs the App on a repo, the page a not-installed refusal names.
const INSTALL_URL = 'https://github.com/apps/workkit-agent';

module.exports = { CLIENT_ID, INSTALL_URL };
