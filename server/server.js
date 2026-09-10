import 'dotenv/config';
import app from './app.js';
import { initializeApplication, logStartupStatus } from './auth-server.js';
import { env, validateProductionEnv } from './config/env.js';
import { logRouteError } from './middleware/errorHandler.js';

async function startServer() {
  validateProductionEnv();
  await initializeApplication();

  const server = app.listen(env.port);
  server.on('listening', logStartupStatus);
  server.on('error', (error) => {
    logRouteError(`Failed to start server on port ${env.port}`, error);
    process.exitCode = 1;
  });
}

startServer().catch((error) => {
  logRouteError('Server startup failed', error);
  process.exitCode = 1;
});
