// Test harness only. Never imported from production app.js or server.js.
import express from 'express';
import { createServerSessionRouter } from './serverSessionRouter.js';
import { createRequireServerSession } from './requireServerSession.js';

export function createServerSessionTestApp(options) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use('/__stage3/auth', createServerSessionRouter(options));
  app.get('/__stage3/protected',createRequireServerSession(options),
    (req,res)=>res.json({userId:req.serverSession.userId}));
  app.post('/__stage3/protected',createRequireServerSession(options),
    (req,res)=>res.json({userId:req.serverSession.userId}));
  app.get('/settings', (_req,res) => res.status(200).send('Synthetic settings'));
  app.get('/reset-password', (_req,res) => res.status(200).send('Synthetic recovery'));
  return app;
}
