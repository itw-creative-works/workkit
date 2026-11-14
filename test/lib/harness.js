// A suite never inherits the supervisor's mark of the run that runs it.
delete process.env.WORKKIT_SUPERVISED;
module.exports = require('workkit-core/test');
