/* Signing in with Google, so a teacher's quizzes follow them.
 *
 * Signing in is optional and changes nothing about how the site works: quizzes
 * still live in this browser, and a teacher who never signs in loses nothing.
 * What signing in adds is a copy kept for them, so the quiz written on the
 * classroom laptop is there on the laptop at home.
 *
 * Nothing here is trusted. The browser gets an ID token from Google and hands
 * it to an edge function, which checks the signature against Google's published
 * keys before it reads or writes a single row. The token cannot be forged and
 * this file cannot reach the table without one.
 */
(function (global) {
  'use strict';

  const CONFIG = {
    apiKey: 'AIzaSyByiYxPJdRy1lppKk93Gu9O2qSnk67yVNo',
    authDomain: 'quiznova-88751.firebaseapp.com',
    projectId: 'quiznova-88751',
    appId: '1:1042467906309:web:ecb2c2b5043db6c71e8d6c'
  };
  const SYNC = 'https://blkwilonabowayxefxpx.supabase.co/functions/v1/quizzes';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.5/';

  let auth = null, loading = null, user = null;
  const listeners = new Set();
  const tell = () => listeners.forEach(fn => { try { fn(user); } catch { /* caller's problem */ } });

  /* The sign-in library is a few hundred kilobytes and most visits never need
   * it, so it is fetched the first time somebody actually signs in — or on load
   * if this browser has signed in before. */
  async function firebase() {
    if (loading) return loading;
    loading = (async () => {
      const [{ initializeApp }, authMod] = await Promise.all([
        import(SDK + 'firebase-app.js'),
        import(SDK + 'firebase-auth.js')
      ]);
      const app = initializeApp(CONFIG);
      auth = authMod.getAuth(app);
      await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
      authMod.onAuthStateChanged(auth, (u) => {
        user = u ? { uid: u.uid, name: u.displayName || u.email || 'Teacher',
                     email: u.email || '', photo: u.photoURL || '' } : null;
        try { localStorage.setItem('nova:signedIn', user ? '1' : ''); } catch { /* private mode */ }
        tell();
        if (user) sync().catch(() => { /* offline: the local copy is still there */ });
      });
      return authMod;
    })();
    return loading;
  }

  async function token() {
    if (!auth || !auth.currentUser) return '';
    try { return await auth.currentUser.getIdToken(); } catch { return ''; }
  }

  async function call(method, body, query) {
    const t = await token();
    if (!t) throw new Error('Not signed in.');
    const res = await fetch(SYNC + (query || ''), {
      method,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not reach your quizzes.');
    return res.json();
  }

  /* Bring the two copies together. Neither side is the master: the same quiz
   * edited in two places keeps whichever was edited last, which is the only
   * answer that never silently throws away a teacher's work. */
  let syncing = null;
  function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      const local = global.Nova && Nova.allQuizzes ? Nova.allQuizzes() : {};
      const { quizzes } = await call('GET');
      const merged = Object.assign({}, local);
      let pulled = 0;
      for (const q of quizzes || []) {
        if (!q || !q.id) continue;
        const here = merged[q.id];
        if (!here || (q.updatedAt || 0) > (here.updatedAt || 0)) { merged[q.id] = q; pulled++; }
      }
      if (pulled && Nova.replaceQuizzes) Nova.replaceQuizzes(merged);
      const list = Object.values(merged);
      if (list.length) await call('POST', { quizzes: list });
      return { pulled, pushed: list.length };
    })().finally(() => { syncing = null; });
    return syncing;
  }

  /* A save while signed in is copied up, but never in the way: the quiz is
   * already safe in this browser by the time this runs, so a failure here is
   * not worth interrupting a teacher for. */
  let soon = null;
  function pushSoon() {
    if (!user || soon) return;
    soon = setTimeout(() => {
      soon = null;
      const all = global.Nova && Nova.allQuizzes ? Object.values(Nova.allQuizzes()) : [];
      if (all.length) call('POST', { quizzes: all }).catch(() => { /* try again next save */ });
    }, 1500);
  }

  async function signIn() {
    const mod = await firebase();
    const provider = new mod.GoogleAuthProvider();
    try {
      await mod.signInWithPopup(auth, provider);
    } catch (err) {
      // a blocked popup is the usual case on a school-managed browser
      if (String(err && err.code).includes('popup')) return mod.signInWithRedirect(auth, provider);
      throw err;
    }
  }

  async function signOut() {
    const mod = await firebase();
    await mod.signOut(auth);
  }

  // somebody who has signed in before should still be signed in when they return
  try { if (localStorage.getItem('nova:signedIn')) firebase(); } catch { /* private mode */ }

  global.NovaAccount = {
    signIn, signOut, sync, pushSoon,
    get user() { return user; },
    onChange(fn) { listeners.add(fn); fn(user); return () => listeners.delete(fn); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
