import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { analyticsController } from '../utils/analytics';
import { readStoredConsent, subscribeConsent } from '../utils/cookieConsent';

export default function AnalyticsTracker({ user, isAuthLoading }) {
  const { pathname, search, hash } = useLocation();
  useEffect(() => {
    const apply = record => analyticsController.update({
      choice: (record === undefined ? readStoredConsent() : record)?.choice,
      pathname,
      hasParameters: Boolean(search || hash),
      authenticated: Boolean(user),
      authLoading: isAuthLoading,
    });
    apply();
    return subscribeConsent(apply);
  }, [pathname, search, hash, user, isAuthLoading]);
  return null;
}
