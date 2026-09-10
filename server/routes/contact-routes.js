import { Resend } from 'resend';

export function registerContactRoutes({
  app,
  db,
  escapeHtml,
  getSessionUser,
  logRouteError,
  normalizeEmailInput,
}) {
  app.post('/api/contact', async (req, res) => {
    const rawMessage = String(req.body?.message || '').trim();
    let name = String(req.body?.name || '').trim();
    let email = normalizeEmailInput(req.body?.email);

    let sessionUser = null;
    if (db) {
      try {
        sessionUser = await getSessionUser(req);
      } catch (err) {
        logRouteError('contact: session lookup failed', err);
        sessionUser = null;
      }
    }

    if (sessionUser) {
      name = String(sessionUser.name || '').trim() || name;
      email = normalizeEmailInput(sessionUser.email) || email;
    }

    if (!name) {
      return res.status(400).json({ message: 'Name is required.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }
    if (rawMessage.length < 3) {
      return res.status(400).json({ message: 'Please enter a message (at least a few characters).' });
    }
    if (rawMessage.length > 10000) {
      return res.status(400).json({ message: 'Message is too long.' });
    }

    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    const toEmail = String(process.env.CONTACT_TO_EMAIL || '').trim();
    const fromEmail = String(
      process.env.CONTACT_FROM_EMAIL || 'Plannix <noreply@plannix.co.uk>',
    ).trim();

    if (!apiKey || !toEmail) {
      return res.status(503).json({
        message:
          'Contact form is not configured. Set RESEND_API_KEY and CONTACT_TO_EMAIL on the server.',
      });
    }

    const resend = new Resend(apiKey);
    const loggedInNote = sessionUser
      ? '<p><em>Sent from a signed-in Plannix account.</em></p>'
      : '';

    const { error } = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      replyTo: email,
      subject: `Plannix contact: ${name}`,
      html: `<p><strong>Name:</strong> ${escapeHtml(name)}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
${loggedInNote}
<p><strong>Message:</strong></p>
<p>${escapeHtml(rawMessage).replace(/\n/g, '<br/>')}</p>`,
    });

    if (error) {
      logRouteError('Resend contact error', error);
      return res.status(502).json({ message: 'Could not send your message. Please try again later.' });
    }

    return res.json({ ok: true });
  });
}
