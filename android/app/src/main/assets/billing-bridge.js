(() => {
  if (window.__noirBillingInstalled) return;
  window.__noirBillingInstalled = true;
  const originalFetch = window.fetch.bind(window);
  let token = '';
  let status = null;
  let storePrice = '';
  let storeReady = false;
  let awaitingPurchase = false;
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
  details.textContent = '12 free panels and 2 screenplay generations. A new script version counts as another generation.';
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  message.dataset.testid = 'android-billing-message';
  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'script-write-button';
  buy.dataset.testid = 'button-subscribe';
  buy.textContent = 'Checking subscription availability…';
  buy.disabled = true;
  buy.onclick = () => { if (storeReady && !awaitingPurchase) window.NoirBilling.purchase(); };
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
  terms.textContent = 'Monthly memberships renew until cancelled in Google Play. Failed attempts may use processing allowance. Usage is limited; billing failure never grants unlimited generation.';
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
    if (!response.ok || value.version !== 2 || typeof value.subscribed !== 'boolean' || !value.remaining) {
      status = null;
      throw new Error(value.error || 'Usage could not be verified. Generation remains blocked.');
    }
    status = value;
    title.textContent = value.subscribed ? 'Monthly membership active' : 'Your free allowance';
    counts.textContent = `${value.remaining.panels} panels · ${value.remaining.scripts} scripts · ${value.remaining.voices} dictations remaining`;
    details.textContent = value.subscribed
      ? `This monthly allowance includes ${value.monthlyLimits.panels} panels, ${value.monthlyLimits.scripts} scripts and ${value.monthlyLimits.voices} voice recordings.`
      : 'Up to 12 free panels, 2 screenplay generations and 12 dictations, subject to abuse-prevention limits. New script versions count as another generation.';
    buy.disabled = value.subscribed || !storeReady || awaitingPurchase;
    if (value.subscribed) buy.textContent = 'Membership active';
    else if (storeReady) buy.textContent = `Subscribe — ${storePrice} / month`;
    return value;
  }
  const ready = (async () => {
    if (!window.NoirBilling) throw new Error('Android billing is unavailable. Generation remains blocked.');
    const response = await originalFetch('/api/billing/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: window.NoirBilling.deviceId() }),
    });
    if (!response.ok) throw new Error('The billing-enabled server is unavailable or not published yet. Generation is blocked to prevent unrestricted charges.');
    const data = await response.json();
    if (!response.ok || data.version !== 2 || typeof data.token !== 'string' || !data.customerId) {
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

  window.__noirBillingUpdate = async update => {
    if (update.price) storePrice = update.price;
    if (update.state === 'ready' && storePrice) storeReady = true;
    if (update.state === 'unavailable') storeReady = false;
    if (update.message) message.textContent = update.message;
    awaitingPurchase = ['purchasing', 'purchased'].includes(update.state);
    buy.disabled = !storeReady || awaitingPurchase || !!status?.subscribed;
    if (storeReady && !status?.subscribed) buy.textContent = `Subscribe — ${storePrice} / month`;
    else if (!storeReady) buy.textContent = 'Subscription unavailable';
    if (['purchased', 'restored'].includes(update.state)) {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const current = await refresh();
          if (current.subscribed) {
            awaitingPurchase = false;
            message.textContent = 'Your subscription is verified. Your monthly allowance is available.';
            return;
          }
        } catch (error) { message.textContent = error.message; }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      awaitingPurchase = false;
      message.textContent = 'A paid subscription has not been verified yet. Access remains limited; restore purchases to try again.';
      buy.disabled = !storeReady || !!status?.subscribed;
    }
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
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-Noir-Session', token);
    const response = await originalFetch(input, { ...init, headers });
    if (response.status === 402) {
      message.textContent = 'This allowance is used up. Subscribe to continue; your existing writing is kept.';
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    refresh().catch(error => { message.textContent = error.message; });
    return response;
  };
})();
