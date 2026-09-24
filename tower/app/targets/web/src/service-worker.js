// The OMEGA service worker manager is bundled into /service-worker.js by the
// framework build (esbuild). Custom service-worker code goes below.
import Manager from '@omega.js/web/service-worker';

// Load Manager
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  // Log
  console.log('Initialized service-worker.js');

  // Custom code
  // ...
});
