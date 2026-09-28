// The OMEGA service worker is bundled into /service-worker.js by the
// framework build (esbuild). Custom service-worker code goes below.
import omega from '@omega.js/web/service-worker';

// Initialize
omega.initialize()
.then(() => {
  // Log
  console.log('Initialized service-worker.js');

  // Custom code
  // ...
});
