import 'dotenv/config';
import app from './app.js';
import { env, validateProductionEnv } from './config/env.js';
import { logRouteError } from './middleware/errorHandler.js';

function startServer() {
  validateProductionEnv();

  const server = app.listen(env.port);
  server.on('listening', () => {
    // eslint-disable-next-line no-console
    console.log('Plannix server is listening.');
  });
  server.on('error', (error) => {
    logRouteError(`Failed to start server on port ${env.port}`, error);
    process.exitCode = 1;
  });
}

try {
  startServer();
} catch (error) {
  logRouteError('Server startup failed', error);
  process.exitCode = 1;
}
