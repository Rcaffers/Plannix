# Notification worker detail protocol (inactive by default)

`MORNING_SUMMARY_DETAIL_DISPLAY_ENABLED` defaults to false. The worker always
receives the existing generic payload. No production setting or binding was
enabled for this work. The detail routes return 404 while the gate is off;
registration continues to create a detail-disabled binding.

## Installation and device policy

Server-mode registration returns the installation version committed by its
versioned RPC. The client does not infer a later version to repair a conflict.
A separate `plannix_push_set_detail_eligibility` operation requires the
verified ordinary session, current binding and installation version, expected
detail-policy version, server-configured pilot, enabled preferences and lesson
consent. It rotates the policy version on every enable or disable. A binding
change rotates it and forces details off. Lesson-consent withdrawal disables
bound devices and rotates their policy versions. Separate event-title consent
is checked by every authorization and again after summary loading.

The worker's IndexedDB record holds only the originating session cookie
**name**, installation version, detail-policy version and a monotonic epoch.
These non-secret selectors provide no authority. A tab observes the epoch
before explicit enable; a delayed response can write only if that epoch is
still current. Invalidation advances it without deleting history. Stale work
cannot read a newer version and retry. No cookie value, account identifier,
CSRF token, lesson or event is stored there.

## Authorization and local coordination

The worker hashes its current PushSubscription endpoint in memory. It holds
the origin-wide `plannix-push-device` Web Lock while reading selectors,
checking the default-off server gate, checking fresh ordinary session status,
getting a no-store detail response, and calling `showNotification`. The
production session guard and database authorization verify owner, binding,
pilot, reference, delivery record, school day, consents and expiry. Missing
storage, lock, subscription, matching session or server authorization selects
generic text.

Local auth mutations use the same lock when available and attempt to
invalidate the selector before sending. The transport covers login, signup, refresh, logout,
account deletion, recovery password and identity-changing profile operations.
Cross-tab notifications, mismatches and context replacement also invalidate
selectors. Registration/removal and consent saves use the device lock; a
preference save invalidates the selector before changing consent. Explicit
device enable is required afterward. Coordination failure cannot prevent
ordinary authentication. If invalidation fails, a worker must still have a
working lock and fresh server authority to display details. The final
authorization-to-display race under simultaneous coordination failure remains
an activation gate below.

The decision has a four-second deadline, including a one-second initial
storage bound and one-second bound on a started display promise. Generic text
is used only **before** a detail `showNotification` call begins. Rejection,
timeout or uncertain completion after that point never triggers a second
notification. Timeout and abort do not cancel an OS display request. Fetched
details stay in worker memory until that call. Displayed content may persist
on lock screens and connected watches and cannot be recalled.

## Activation gates and residual limits

- A synthetic Chrome check proves native worker/tab lock sharing, selector
  invalidation during held authorization and one generic display. It uses a
  test-only synthetic subscription; it does not prove iOS, paired watches or
  live push delivery.
- Callback navigation and remote revocation cannot be atomic with an OS
  display already underway. Server rechecks narrow that race but cannot
  recall a notification.
- If local lock and selector coordination both fail after an old worker has
  crossed final authorization, authentication still completes and the display
  result is uncertain. Detail activation requires browser/topology evidence
  that this case fails safely. A worker without Web Locks always uses generic.
- Test supported phones in foreground/background, callbacks, account and
  session replacement, consent withdrawal, storage eviction, and uncertain
  OS display before activation. The production-guarded held-snapshot event
  consent test and direct expired-session RPC test cover separate server gates.

The generic pilot and notification-click ownership behavior remain intact.
There is no browser-readable session secret, alternate worker credential or
direct Supabase authorization path.
