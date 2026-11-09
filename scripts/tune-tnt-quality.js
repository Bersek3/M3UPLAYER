'use strict';
// Keep the original TNT command compatible with existing VM instructions.
const { main } = require('./tune-channel-quality');
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
