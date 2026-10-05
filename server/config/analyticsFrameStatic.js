import path from 'node:path';
import helmet from 'helmet';

// Only the opaque sandbox's public bootstrap needs cross-origin resource access.
export function registerAnalyticsFrameStatic({ app, distDirectory, frameCsp }) {
  if (!frameCsp) return;
  app.get('/analytics-frame.html',
    helmet.contentSecurityPolicy(frameCsp),
    (_req, res, next) => res.sendFile(path.join(distDirectory, 'analytics-frame.html'), error => {
      if (error) next(error);
    }));
  app.get('/analytics-frame.js', (req, res, next) => {
    if (req.path !== '/analytics-frame.js') return next();
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.sendFile(path.join(distDirectory, 'analytics-frame.js'), error => {
      if (error) next(error);
    });
  });
}
