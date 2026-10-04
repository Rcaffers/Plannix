// Child-process-only loader: the production server entry point and signal handler
// run with an in-memory HTTP server and a synthetic polling dependency.
import { registerHooks } from 'node:module';

const modules = new Map([
  ['dotenv/config', ''],
  ['./app.js', `
    import http from 'node:http';
    export default {
      listen() {
        return http.createServer((_request, response) => response.end('ok'))
          .listen(0, '127.0.0.1');
      },
    };
  `],
  ['./config/env.js', `
    export const env = { port: 0 };
    export function validateProductionEnv() {}
  `],
  ['./middleware/errorHandler.js', 'export function logRouteError() {}'],
  ['./morningSummary/pilotConfig.js', `
    export function pilotUserFromEnvironment() {
      return process.env.SHUTDOWN_CASE === 'disabled'
        ? null : 'cb000000-0000-4000-8000-000000000041';
    }
  `],
  ['./morningSummary/polling.js', `
    export function createMorningSummaryPolling() {
      let handle;
      return {
        start() {
          handle = setInterval(() => {}, 1000);
          process.stdout.write('synthetic-polling-started\\n');
        },
        async stop() {
          if (process.env.SHUTDOWN_CASE === 'clean') {
            clearInterval(handle);
            return true;
          }
          if (process.env.SHUTDOWN_CASE === 'reject') throw new Error('synthetic cleanup failure');
          // The interval deliberately retains a live handle after cancellation.
          return false;
        },
      };
    }
  `],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/server/server.js') && modules.has(specifier)) {
      return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
