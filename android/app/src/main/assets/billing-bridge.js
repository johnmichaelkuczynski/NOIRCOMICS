(() => {
  if (window.__noirBillingInstalled) return;
  window.__noirBillingInstalled = true;
  const originalFetch = window.fetch.bind(window);
  let token = '';
  let status = null;
  let storePrice = '';
  let storeReady = false;
  let awaitingPurchase = false;
  let syncing = false;
  let pendingPayment = false;
  const proofs = new Map();
  window.__noirIntegrityResult = result => {
    const callback = proofs.get(result.requestId);
    if (!callback) return;
    proofs.delete(result.requestId);
    clearTimeout(callback.timer);
    if (result.error) callback.reject(new Error(result.error));
    else callback.resolve(result);
  };
  async function getChallenge(purpose) {
    const response = await originalFetch(`/api/billing/challenge?purpose=${purpose}`, {
      headers: token ? { 'X-Noir-Session': token } : {}, cache: 'no-store',
    });
    const value = await response.json();
    if (!response.ok || value.version !== 4) throw new Error(value.error || 'The updated Android billing backend is unavailable.');
    return value;
  }
  function nativeProof(method, challenge, ...args) {
    const id = crypto.randomUUID().replaceAll('-', '');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { proofs.delete(id); reject(new Error('Google Play verification timed out. No access was granted.')); }, 60000);
      proofs.set(id, { resolve, reject, timer });
      try { window.NoirBilling[method](JSON.stringify(challenge), ...args, id); }
      catch (error) { clearTimeout(timer); proofs.delete(id); reject(error); }
    });
  }
  const card = document.createElement('section');
  card.className = 'script-draft';
  card.style.cssText = 'margin:0 0 24px;padding:20px;scroll-margin-top:20px';
  card.dataset.testid = 'android-billing-status';
  const title = document.createElement('h2');
  title.style.cssText = 'font-size:24px;margin:0 0 10px';
  title.textContent = 'Your free allowance';
  const counts = document.createElement('p');
  counts.textContent = 'Checking secure usage limits…';
  const details = document.createElement('p');
  details.className = 'usage-note';
  details.textContent = 'Two complete comic generations are free. Failed comic generations do not use this allowance.';
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  message.dataset.testid = 'android-billing-message';
  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'script-write-button';
  buy.dataset.testid = 'button-subscribe';
  buy.textContent = 'Checking subscription availability…';
  buy.disabled = true;
  buy.onclick = async () => {
    if (!storeReady || awaitingPurchase || syncing) return;
    awaitingPurchase = true;
    buy.disabled = true;
    message.textContent = 'Checking the monthly price with Google Play…';
    try {
      const check = await originalFetch('/api/billing/catalog', { headers: { 'X-Noir-Session': token } });
      const catalog = await check.json();
      if (!check.ok || catalog.usdPrice !== '4.95' || catalog.billingPeriod !== 'P1M') {
        throw new Error(catalog.error || 'Google Play must have the USD $4.95 monthly plan configured.');
      }
      window.NoirBilling.purchase();
    } catch (error) {
      awaitingPurchase = false;
      buy.disabled = !storeReady || !!status?.subscribed;
      message.textContent = error.message;
    }
  };
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'file-button';
  restore.textContent = 'Restore purchases';
  restore.disabled = true;
  restore.onclick = () => window.NoirBilling.restore();
  const manage = document.createElement('button');
  manage.type = 'button';
  manage.className = 'file-button';
  manage.textContent = 'Manage subscription';
  manage.onclick = () => window.NoirBilling.manage();
  const terms = document.createElement('p');
  terms.className = 'usage-note';
  terms.textContent = 'Monthly memberships renew until cancelled in Google Play. Failed comic generations do not use the two-comic trial. Paid usage limits are shown above.';
  card.append(title, counts, details, message, buy, restore, manage, terms);
  const mount = () => {
    const target = document.querySelector('main');
    if (target) { target.prepend(card); return; }
    const observer = new MutationObserver(() => {
      const main = document.querySelector('main');
      if (main) { main.prepend(card); observer.disconnect(); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      if (!card.isConnected && document.body) { document.body.prepend(card); observer.disconnect(); }
    }, 3000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  async function refresh() {
    if (!token) throw new Error('Secure billing has not connected. Generation remains blocked.');
    const response = await originalFetch('/api/billing/usage', { headers: { 'X-Noir-Session': token }, cache: 'no-store' });
    const value = await response.json();
    if (!response.ok || value.version !== 4 || typeof value.subscribed !== 'boolean' || !value.remaining ||
      (!value.subscribed && typeof value.freeComics?.remaining !== 'number')) {
      status = null;
      throw new Error(value.error || 'Usage could not be verified. Generation remains blocked.');
    }
    status = value;
    title.textContent = value.subscribed ? 'Monthly membership active' : 'Your free allowance';
    counts.textContent = value.subscribed
      ? `${value.remaining.panels} panels · ${value.remaining.scripts} scripts · ${value.remaining.voices} dictations remaining`
      : `${value.freeComics.remaining} of 2 free comic generations remaining`;
    details.textContent = value.subscribed
      ? `This monthly allowance includes ${value.monthlyLimits.panels} panels, ${value.monthlyLimits.scripts} scripts and ${value.monthlyLimits.voices} voice recordings. ${value.autoRenew ? 'Renews monthly.' : 'Renewal cancelled.'} ${value.expiresAt ? 'Paid access through ' + new Date(value.expiresAt).toLocaleDateString() + '.' : ''}`
      : 'The two-comic allowance is stored on the server and survives normal reinstall with the same signing key. Failed or incomplete comics do not count.';
    if (!value.subscribed && value.freeComics.remaining === 0) {
      title.textContent = 'Subscribe to create more comics';
      message.textContent = 'Your two free comics have been used. Subscribe to continue; your existing writing and downloads are kept.';
    }
    buy.disabled = value.subscribed || !storeReady || awaitingPurchase || syncing;
    if (value.subscribed) buy.textContent = 'Membership active';
    else if (storeReady) buy.textContent = `Subscribe — ${storePrice} / month`;
    return value;
  }
  const ready = (async () => {
    if (!window.NoirBilling) throw new Error('Android billing is unavailable. Generation remains blocked.');
    const challenge = await getChallenge('session');
    const proof = await nativeProof('establishSession', challenge);
    const response = await originalFetch('/api/billing/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proof),
    });
    if (!response.ok) throw new Error('The billing-enabled server is unavailable or not published yet. Generation is blocked to prevent unrestricted charges.');
    const data = await response.json();
    if (!response.ok || data.version !== 4 || typeof data.token !== 'string' || !data.customerId) {
      throw new Error('The billing-enabled server is not published yet. Generation is blocked to prevent unrestricted charges.');
    }
    token = data.token;
    window.NoirBilling.identify(data.customerId);
    restore.disabled = false;
    return refresh();
  })();
  ready.catch(error => {
    message.textContent = error.message || 'Billing verification failed. Generation remains blocked.';
    counts.textContent = 'Generation blocked — secure usage limits unavailable';
    buy.textContent = 'Subscription unavailable';
  });

  async function synchronize() {
    if (syncing || !token) return;
    syncing = true;
    buy.disabled = true;
    restore.disabled = true;
    try {
      const challenge = await getChallenge('receipt');
      const proof = await nativeProof('synchronizePurchases', challenge);
      const response = await originalFetch('/api/billing/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Noir-Session': token },
        body: JSON.stringify(proof),
      });
      const value = await response.json();
      if (!response.ok || !value.verified || !value.subscribed) throw new Error(value.error || 'Google Play did not verify a paid subscription.');
      const current = await refresh();
      if (!current.subscribed) throw new Error('Paid access is not verified yet. Restore purchases to retry.');
      pendingPayment = false;
      message.textContent = 'Google Play verified your payment. Your monthly allowance is available.';
    } catch (error) {
      pendingPayment = /pending/i.test(error.message);
      message.textContent = error.message;
      await refresh().catch(() => {});
    } finally {
      syncing = false;
      awaitingPurchase = false;
      restore.disabled = !token;
      buy.disabled = !storeReady || !!status?.subscribed;
    }
  }
  window.__noirBillingUpdate = async update => {
    if (update.price) storePrice = update.price;
    if (update.state === 'ready' && storePrice) storeReady = true;
    if (update.state === 'unavailable') storeReady = false;
    if (update.message) message.textContent = update.message;
    awaitingPurchase = ['purchasing', 'purchased', 'check-owned'].includes(update.state);
    buy.disabled = !storeReady || awaitingPurchase || syncing || !!status?.subscribed;
    if (storeReady && !status?.subscribed) buy.textContent = `Subscribe — ${storePrice} / month`;
    else if (!storeReady) buy.textContent = 'Subscription unavailable';
    if (['purchased', 'restored', 'check-owned'].includes(update.state)) await synchronize();
  };
  window.__noirResumeBilling = () => {
    if (!token) return;
    if (pendingPayment || awaitingPurchase) synchronize();
    else refresh().catch(error => { message.textContent = error.message; });
  };
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const action = url.origin === location.origin && /^\/api\/comics\/(generate|script|transcribe)$/.test(url.pathname);
    if (!action) return originalFetch(input, init);
    await ready.catch(async error => {
      if (!token) throw error;
      return refresh();
    });
    // An unavailable or old backend can never fall back to an unmetered endpoint.
    if (!token) throw new Error('Secure usage verification failed. Generation remains blocked.');
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set('X-Noir-Session', token);
    const bytes = await request.clone().arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const challenge = await getChallenge('generation');
    const proof = await nativeProof('attestGeneration', challenge, url.pathname, hash);
    headers.set('X-Noir-Nonce', proof.nonce);
    headers.set('X-Noir-Integrity', proof.integrityToken);
    const response = await originalFetch(new Request(request, { headers }));
    if (response.status === 402) {
      message.textContent = 'This allowance is used up. Subscribe to continue; your existing writing is kept.';
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    refresh().catch(error => { message.textContent = error.message; });
    return response;
  };
})();
