// The tower's dialogs (issue, crew card, published document): the one door,
// re-exporting modal/, with modal/issue.js by name since `openFrom` is its
// siblings'. The markup is the layout's (_layouts/tower/page.html); every field
// is escaped, and the markdown renderer is handed in at mount to stay pure.

export {
  issueTrigger, issueItem, externalLink, holdBoard, dependencies, issueDialog, mountIssueModal,
} from './modal/issue.js';
export * from './modal/agent.js';
export * from './modal/document.js';
