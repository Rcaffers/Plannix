export function registerBillingRoutes({
  app,
  findLatestStripeSubscriptionForCustomer,
  findStripeCustomerByEmail,
  inferredPublicOrigin,
  logRouteError,
  primaryFrontendOrigin,
  requireDb,
  requireSessionUser,
  sendError,
  stripe,
  subscriptionPricePayloadFromSubscription,
}) {
  app.get('/billing/subscription-summary', async (req, res) => {
    if (!requireDb(res)) {
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;
    if (!stripe) {
      return res.json({
        enabled: false,
        subscription: null,
      });
    }
    try {
      const customer = await findStripeCustomerByEmail(user.email);
      if (!customer) {
        return res.json({
          enabled: true,
          subscription: null,
        });
      }
      const subscription = await findLatestStripeSubscriptionForCustomer(customer.id);
      if (!subscription) {
        return res.json({
          enabled: true,
          subscription: null,
        });
      }
      return res.json({
        enabled: true,
        subscription: {
          id: subscription.id,
          status: subscription.status,
          cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
          currentPeriodEnd: subscription.current_period_end || null,
          canceledAt: subscription.canceled_at || null,
          price: subscriptionPricePayloadFromSubscription(subscription),
        },
      });
    } catch (error) {
      // Degrade gracefully when Stripe has transient connectivity issues.
      logRouteError('subscription-summary Stripe lookup failed', error);
      return res.json({
        enabled: true,
        subscription: null,
        warning:
          'An error occurred with our connection to Stripe. Please retry in a moment.',
      });
    }
  });

  app.post('/billing/portal-session', async (req, res) => {
    if (!requireDb(res)) {
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;
    if (!stripe) {
      return res.status(503).json({ message: 'Billing is not enabled on this server.' });
    }
    const mode = String(req.body?.mode || '').trim().toLowerCase();
    const subscriptionId = String(req.body?.subscriptionId || '').trim();
    try {
      const customer = await findStripeCustomerByEmail(user.email);
      if (!customer) {
        return res.status(404).json({ message: 'No Stripe customer found for this account yet.' });
      }
      const returnOrigin = primaryFrontendOrigin || inferredPublicOrigin(req);
      if (!returnOrigin) {
        return res.status(503).json({
          message: 'Billing portal is not configured. Set FRONTEND_ORIGIN on the server.',
        });
      }
      const payload = {
        customer: customer.id,
        return_url: `${returnOrigin}/settings/subscription`,
      };
      if (mode === 'cancel' && subscriptionId) {
        payload.flow_data = {
          type: 'subscription_cancel',
          subscription_cancel: {
            subscription: subscriptionId,
          },
        };
      }
      const session = await stripe.billingPortal.sessions.create(payload);
      return res.json({ url: session.url });
    } catch (error) {
      return sendError(res, error, 'Could not open billing portal.', 502);
    }
  });
}
