/**
 * workflow/standards/templates.js: the issue forms a repo receives from the
 * kit's templates, each installed once and never overwritten. A step of the
 * heal, run in the repo root.
 * Usage: const { ensureIssueForms } = require('./templates');
 */

const fs = require('fs');
const { isFile } = require('../lib/lock');
const { nativePath } = require('../lib/platform');
const { ok, skip } = require('../lib/voice');
const { flag } = require('./flag');

const FORMS_DEST = '.github/ISSUE_TEMPLATE';
const FORMS = ['bug', 'enhancement', 'idea', 'dump'];

/**
 * Each missing form copied in from the kit's issue-forms templates; a missing
 * template, or a form or folder that cannot be written, flags the run.
 * @param {{kit: string, needsAttention: boolean}} run
 */
const ensureIssueForms = (run) => {
  const source = `${run.kit}/workflow/templates/issue-forms`;
  let created = 0;
  let existing = 0;
  try {
    fs.mkdirSync(FORMS_DEST, { recursive: true });
  } catch {
    flag(run, `issue forms: could not write ${FORMS_DEST}`);
    return;
  }
  for (const form of FORMS) {
    const dest = `${FORMS_DEST}/${form}.md`;
    const template = `${source}/${form}.md`;
    if (isFile(dest)) {
      existing += 1;
    } else if (!isFile(template)) {
      flag(run, `issue forms: template missing at ${nativePath(template)}; reinstall the workflow core`);
    } else {
      try {
        fs.copyFileSync(template, dest);
        created += 1;
      } catch {
        flag(run, `issue forms: could not write ${dest}`);
      }
    }
  }
  if (created > 0) ok(`issue forms: created ${created} in ${FORMS_DEST}`);
  if (existing > 0) skip(`issue forms: ${existing} already present`);
};

module.exports = { ensureIssueForms };
