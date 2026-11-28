// makeGhStub's answers, run in the fake gh's own process (helpers.js beside it).
// It loads only Node's modules, so the stand-in starts on any PATH a case
// narrows, the no-tools mirror among them (docs/tests.md § The shape).

const fs = require('fs');

/**
 * makeGhStub's answer to one call, its options as `config`: what it prints, and
 * its exit code. A PUT or PATCH body is read off stdin into its file.
 * @returns {number} the exit code
 */
const answerStandards = (config, argv) => {
  const command = `${argv[0]} ${argv[1]}`;
  const says = (text) => process.stdout.write(text);
  const fails = (line) => { process.stderr.write(`${line}\n`); return 1; };
  if (command === 'auth status') return config.authed ? 0 : 1;
  if (command === 'label list') { says(JSON.stringify(config.labels)); return 0; }
  if (command === 'issue list') {
    // A --label query asks who carries one label; without it this is the
    // whole-repo report, which gets the full fixture.
    const at = argv.lastIndexOf('--label');
    if (at === -1 || at === argv.length - 1) { says(JSON.stringify(config.issues)); return 0; }
    if (config.labelQueryFails) return 1;
    const want = argv[at + 1];
    says(Object.hasOwn(config.labeled, want) ? JSON.stringify(config.labeled[want]) : '[]\n');
    return 0;
  }
  if (command === 'issue edit') return 0;
  if (command === 'label create') return config.createFails ? 1 : 0;
  if (command === 'label edit') return config.editFails ? 1 : 0;
  if (argv[0] !== 'api') return 0;
  const asks = (field) => argv.some((arg) => arg.includes(field));
  if (argv[1] === 'repos/{owner}/{repo}' || argv[1] === 'repos/stub/repo') {
    if (config.repoRead && asks('.full_name')) says('stub/repo\n');
    if (config.repoRead && asks('.default_branch')) says(`${config.defaultBranch}\n`);
    return 0;
  }
  if (argv[1].includes('/contents/.github/workflows/checks.yml')) {
    if (config.remoteChecks === null) return fails('gh: Not Found (HTTP 404)');
    says(config.remoteChecks);
    return 0;
  }
  const sends = (method) => argv.some((arg, i) => arg === '-X' && argv[i + 1] === method);
  if (sends('PUT')) {
    fs.writeFileSync(config.putBody, fs.readFileSync(0));
    return config.protection === 'denied' ? 1 : 0;
  }
  if (sends('PATCH')) {
    fs.writeFileSync(config.patchBody, fs.readFileSync(0));
    return config.patchFails ? 1 : 0;
  }
  if (config.protection === 'present') { says(config.protectionBody); return 0; }
  // A real 404 answers with this text; the heal must see it to distinguish
  // "unprotected" from a transient failure it must not write over.
  if (config.protection === 'unreadable') return fails('gh: API rate limit exceeded');
  return fails('gh: Branch not protected (HTTP 404)');
};

module.exports = { answerStandards };
