import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { matchPath } from 'react-router-dom';
import { transformWithOxc } from 'vite';
import { privateRouteState } from './supabaseAuthController.js';
const paths = ['App', 'pages/Settings', 'pages/OrganisationControls', 'pages/AcademicYear', 'pages/Classes',
  'pages/Profile', 'pages/ResetPassword', 'pages/Contact', 'components/Header', 'components/ProjectCard',
  'components/SchoolHolidayAiImport', 'components/AiProviderCard', 'components/ClassPlacementPalette', 'components/DeleteAccountSection'];
for (const path of paths) test(path + ' uses shared accessible status utility', async () => {
  const source = await readFile('src/' + path + '.jsx', 'utf8');
  assert.doesNotMatch(source, /styles\/accessibility.css/);
  if (path !== 'components/ClassPlacementPalette') assert.match(source, /visually-hidden/);
  for (const match of source.matchAll(/<p([^>]*)role="status"([^>]*)>((?:Loading|Checking)[^<]*)<\/p>/g)) {
    assert.match(match[1] + match[2], /visually-hidden/);
  }
});
test('production imports the shared stylesheet once and isolated fixtures import it themselves', async () => {
  const main = await readFile('src/main.jsx', 'utf8');
  assert.match(main, /import '\.\/styles\/accessibility.css'/);
  for (const fixture of ['components/AiProviderCard.browser-test', 'components/ClassPlacementPalette.browser-test',
    'components/ProjectCard.modal-browser-test', 'components/ProjectCard.responsive-browser-test', 'pages/AcademicYear.ai-browser-test']) {
    assert.match(await readFile(`src/${fixture}.jsx`, 'utf8'), /styles\/accessibility.css/);
  }
});
test('actual App route gate blocks early content for both loading presentations', async () => {
  const app = await readFile('src/App.jsx', 'utf8');
  // Execute App's callback rather than assuming a particular JSX/source layout.
  const callback = app.match(/  const privateRoute = \(element\) => \{[\s\S]*?\n  \};/)?.[0];
  assert.ok(callback, 'App private-route callback must be found');
  const { code } = await transformWithOxc(callback, 'private-route.jsx', { jsx:{ runtime:'classic' } });
  const ProfileVerificationView = () => null;
  const run = new Function('env', 'React', 'privateRouteState', 'matchPath', 'ProfileVerificationView', `
    const {serverManagedAuth, sessionVerificationError, isAuthLoading, user, location} = env;
    const Hero = () => null, HomeHighlights = () => null, CTASection = () => null;
    ${code}
    return privateRoute(env.element);
  `);
  const protectedContent = React.createElement('section', { 'data-private':true }, 'Private account content');
  const route = (overrides = {}) => run({
    serverManagedAuth:true, sessionVerificationError:false, isAuthLoading:true,
    user:null, location:{ pathname:'/timetable' }, element:protectedContent, ...overrides,
  }, React, privateRouteState, matchPath, ProfileVerificationView);
  for (const serverManagedAuth of [true, false]) {
    for (const user of [null, {id:'cached-account'}]) {
      for (const pathname of ['/timetable', '/profile', '/PROFILE/']) {
        const view = route({serverManagedAuth, user, location:{pathname}});
        assert.notEqual(view, protectedContent, 'Pending verification never returns protected content, even with a cached user');
        if (serverManagedAuth && pathname.toLowerCase().startsWith('/profile')) {
          assert.equal(view.type, ProfileVerificationView);
          assert.deepEqual(view.props, {}, 'Profile loading view receives no unverified account details');
        } else {
          assert.equal(view.type, 'main');
          assert.equal(view.props['aria-busy'], 'true');
          assert.equal(view.props.children.props.role, 'status');
          assert.equal(view.props.children.props.className, 'visually-hidden');
          assert.equal(view.props.children.props.children, 'Checking your session…');
        }
      }
    }
    assert.equal(route({serverManagedAuth, isAuthLoading:false, user:{id:'verified'}}), protectedContent);
    const signedOut = route({serverManagedAuth, isAuthLoading:false});
    assert.notEqual(signedOut, protectedContent);
    assert.equal(signedOut.type, 'main');
    assert.equal(signedOut.props.children[0].props.user, null);
  }
  assert.equal(route({sessionVerificationError:true, user:{id:'cached'}}).props.role, 'alert');
  const profileFailure = route({sessionVerificationError:true, location:{pathname:'/profile'}, user:{id:'cached'}});
  assert.equal(profileFailure.type, ProfileVerificationView);
  assert.equal(profileFailure.props.error, true);
});
test('actionable profile confirmation stays visible', async () => {
  const profile = await readFile('src/pages/Profile.jsx', 'utf8');
  assert.match(profile, /actionRequired: result.confirmationPending/);
  assert.match(profile, /status.state === 'success' && !status.actionRequired/);
});
test('shared status utility clips without hiding from accessibility tree', async () => {
  const css = await readFile('src/styles/accessibility.css', 'utf8');
  assert.match(css, /position: absolute/);
  assert.match(css, /clip-path: inset\(50%\)/);
  assert.doesNotMatch(css, /display:\s*none|visibility:\s*hidden/);
});
