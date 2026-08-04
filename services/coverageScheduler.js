const coverageService = require('./coverageService');

/**
 * Periodic sweep for shift-coverage offers that have passed their expiry
 * without being claimed. There is no job queue or cron anywhere in this
 * codebase (see CLAUDE.md "Deployment"), and Railway runs a single instance,
 * so an in-process setInterval is safe. Each sweep transition is additionally
 * guarded by an atomic findOneAndUpdate in coverageService.expireOpenOffers,
 * so it stays correct even if that assumption ever changes.
 */

let timer = null;

exports.start = () => {
  if (timer) return; // already running
  if (process.env.COVERAGE_ENABLED !== 'true') {
    console.log('   ⏸️  Coverage scheduler not started (COVERAGE_ENABLED is not "true")');
    return;
  }

  const interval = parseInt(process.env.COVERAGE_SWEEP_INTERVAL_MS, 10) || 60000;
  timer = setInterval(() => {
    coverageService.expireOpenOffers(new Date())
      .catch(err => console.error('❌ Coverage sweep error:', err));
  }, interval);

  // Never let the sweep keep the process alive by itself (matters for
  // scripts that require server-side modules without wanting a live server).
  timer.unref();

  console.log(`   ⏱️  Coverage sweep started (every ${interval}ms)`);
};

exports.stop = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};
