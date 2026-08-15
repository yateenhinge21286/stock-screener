const { executeScan } = require('./scheduler');

console.log('Starting CLI scan execution...');

// Run a manual-type execution but output logs straight to stdout
executeScan(false)
  .then((results) => {
    console.log(`CLI scan execution complete. Found ${results.length} matched stocks.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('CLI scan execution failed:', err);
    process.exit(1);
  });
