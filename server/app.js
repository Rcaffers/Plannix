// Legacy route definitions remain in auth-server.js during the staged refactor.
// Importing this module configures Express but never opens a network listener.
export { app as default, app } from './auth-server.js';
