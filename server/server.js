import 'dotenv/config';
import app from './app.js';
import { env, validateProductionEnv } from './config/env.js';
import { logRouteError } from './middleware/errorHandler.js';
import { pilotUserFromEnvironment } from './morningSummary/pilotConfig.js';
import { createMorningSummaryPolling } from './morningSummary/polling.js';

function startServer() {
  validateProductionEnv();

  const server = app.listen(env.port);
  let polling = null;
  server.on('listening', () => {
    // eslint-disable-next-line no-console
    console.log('Plannix server is listening.');
    try {
      const pilotUserId = pilotUserFromEnvironment(process.env, 'MORNING_SUMMARY_POLLING_ENABLED');
      if (pilotUserId) {
        polling = createMorningSummaryPolling({ pilotUserId });
        polling.start();
      }
    } catch {
      // Configuration failures do not stop the website or start delivery.
      console.error('Morning summary polling is disabled: invalid pilot configuration.');
    }
  });
  server.on('error', (error) => {
    logRouteError(`Failed to start server on port ${env.port}`, error);
    process.exitCode = 1;
  });
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => process.exit(1), 15_000);
    let listenerClosed = false;
    let pollingClosed = false;
    const finishIfClosed = () => {
      // A timed-out or rejected stop cannot prove the active cycle released its handles.
      if (listenerClosed && pollingClosed) clearTimeout(deadline);
    };
    server.close((error) => {
      if (!error) listenerClosed = true;
      finishIfClosed();
    });
    Promise.resolve().then(() => polling?.stop({ graceMs: 10_000 }) ?? true).then((stopped) => {
      pollingClosed = stopped === true;
      if (!pollingClosed) server.closeAllConnections();
      finishIfClosed();
    }).catch(() => {
      // Keep the hard deadline armed when cleanup cannot be confirmed.
      server.closeAllConnections();
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

try {
  startServer();
} catch (error) {
  logRouteError('Server startup failed', error);
  process.exitCode = 1;
}
