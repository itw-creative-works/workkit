//
// The issue bodies both Spec-gate suites judge: the endpoint's (server/relabel)
// and the page-side copy's (app/github-writes) give each body the same answer.
//

// The fenced `## ` line ends the section only for a walk that ignores fences,
// which would leave the Contract outside it.
const WITH_CONTRACT = [
  '## Description', '', 'The board needs the gate.', '',
  '## Spec', '', 'Gate the move.', '', '```md', '## not a heading, inside a fence', '```', '',
  '### Contract', '', '**Files**', '- tower/api/server/writes.js', '',
  '## Notes', '', 'after the Spec',
].join('\n');

// Two Contracts, neither inside the Spec: before it, and in the section after.
const WITHOUT_CONTRACT = [
  '## Description', '', '### Contract', '', 'not this one', '',
  '## Spec', '', 'Gate the move, in prose and nothing more.', '',
  '## Notes', '', '### Contract', '', 'nor this one',
].join('\n');

const SMALL_ITEM = ['## Description', '', 'A typo.', '', '## Spec', '', 'None needed: small item.', ''].join('\n');
// The small-item Spec as a browser text box saves it: CRLF line ends, the line padded.
const SMALL_ITEM_PADDED = ['## Description', '', 'A typo.', '', '## Spec', '', '  None needed: small item. \t', ''].join('\r\n');
const NO_SPEC = ['## Description', '', 'A thought, not yet specced.', ''].join('\n');

/** The Contract refusal, as both routes word it for issue `number`. */
const contractReason = (number) => `issue #${number} has a written Spec with no ### Contract, so it cannot move to status:specced. `
  + 'Add Files, Names and Cases, or the small-item line None needed: small item., then move the card.';

/** The no-Spec refusal, as both routes word it for issue `number`. */
const noSpecReason = (number) => `issue #${number} has no ## Spec, so it cannot move to status:specced.`;

module.exports = {
  WITH_CONTRACT, WITHOUT_CONTRACT, SMALL_ITEM, SMALL_ITEM_PADDED, NO_SPEC, contractReason, noSpecReason,
};
