import 'dotenv/config';
import { createMorningSummaryDelivery } from './delivery.js';
import { pilotUserFromEnvironment } from './pilotConfig.js';

// This process is intentionally one-shot and disabled by default. A separate
// scheduler may invoke it only after deployment verification in Stage 3.
if (process.env.MORNING_SUMMARY_WORKER_ENABLED !== 'true') {
  process.exitCode = 0;
} else {
  const watchdog = setTimeout(() => process.exit(1), 60000);
  try {
    const pilotUserId = pilotUserFromEnvironment(process.env, 'MORNING_SUMMARY_WORKER_ENABLED');
    const result = await createMorningSummaryDelivery().run({ pilotUserId });
    clearTimeout(watchdog);
    // Counts contain no recipient, event, subscription or credential data.
    console.info(`Morning summary worker completed ${result.claimed} claims.`);
  } catch {
    clearTimeout(watchdog);
    console.error('Morning summary worker failed.');
    process.exitCode = 1;
  }
}
