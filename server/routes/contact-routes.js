import { Resend } from 'resend';

export function registerContactRoutes({
  app,
  createResend = (apiKey) => new Resend(apiKey),
  escapeHtml,
  getContactConfig = () => ({
    apiKey: String(process.env.RESEND_API_KEY || '').trim(),
    toEmail: String(process.env.CONTACT_TO_EMAIL || '').trim(),
    fromEmail: String(
      process.env.CONTACT_FROM_EMAIL || 'Plannix <noreply@plannix.co.uk>',
    ).trim(),
  }),
  logRouteError,
  normalizeEmailInput,
}) {
  app.post('/api/contact', async (req, res) => {
    const rawMessage = String(req.body?.message || '').trim();
    const name = String(req.body?.name || '').trim();
    const email = normalizeEmailInput(req.body?.email);

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

    const { apiKey, toEmail, fromEmail } = getContactConfig();

    if (!apiKey || !toEmail) {
      return res.status(503).json({
        message:
          'Contact form is not configured. Set RESEND_API_KEY and CONTACT_TO_EMAIL on the server.',
      });
    }

    const resend = createResend(apiKey);

    const { error } = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      replyTo: email,
      subject: `Plannix contact: ${name}`,
      html: `<p><strong>Name:</strong> ${escapeHtml(name)}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<p><strong>Message:</strong></p>
<p>${escapeHtml(rawMessage).replace(/\n/g, '<br/>')}</p>`,
    });

    if (error) {
      logRouteError('Resend contact error', error, req);
      return res.status(502).json({ message: 'Could not send your message. Please try again later.' });
    }

    return res.json({ ok: true });
  });
}
