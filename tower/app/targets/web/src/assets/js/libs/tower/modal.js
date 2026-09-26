//
// The tower's dialogs - what clicking an issue does, what clicking a crew card
// does, and what clicking a published brief or summary does, everywhere on the
// tower.
//
// Before this, every issue on every page was an anchor to github.com, so the
// only way to read one was to leave the dashboard. Now a click OPENS it here -
// title, number, repo, status and chips, the body rendered, who holds it, when
// it was filed and last touched, what it waits on and what it blocks, and how
// many comments are waiting - and GitHub is reached only through the explicit
// external-link button, which is in the dialog and on each card while it is
// hovered or focused. Nothing navigates by accident.
//
// The dialog's markup is the LAYOUT's (_layouts/tower/page.html), like the
// intake dialog's: the theme ships Bootstrap's modal and the tower supplies
// only what markup cannot know. This file fills it and decides when it opens.
//
// Click sites do not each need a listener. A card carries `data-issue` with a
// `repo#number` key, `issueTrigger()` records the issue object under that key
// as the markup is built, and ONE delegated listener on the document opens
// whatever was clicked - so a page that repaints ten times a minute never
// rebinds anything, and a new click site is one attribute.
//
// Every field is attacker-controlled text: titles, bodies and handles come from
// GitHub's API and are escaped (or run through the markdown renderer, which
// escapes first) without exception.
//
// The renderer itself is the framework's - `omega.utilities().renderMarkdown`,
// which this file never names. It is handed in at mount instead, from the main
// bundle that already holds the client singleton, which is what keeps every
// markup function here a pure string function the suite can ask questions of
// under Node.
//
// The SECTIONS live beside this file in modal/, one module each: the issue
// dialog, the crew card's dialog and the published document's dialog. This
// file keeps the one door and re-exports every piece's public names, so a
// caller imports every dialog from here. The issue piece is re-exported by
// name, because it also exports `openFrom`, the delegated opener its two
// siblings import.
//

export {
  issueTrigger, issueItem, externalLink, holdBoard, dependencies, issueDialog, mountIssueModal,
} from './modal/issue.js';
export * from './modal/agent.js';
export * from './modal/document.js';
