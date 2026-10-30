(() => {
  const api = String(window.SHADOW_PAIR_API || '').replace(/\/$/, '');
  const $ = id => document.getElementById(id);
  let requestId = null, poller = null;
  const result = $('result'), generate = $('generate');

  function show(status, message, code) {
    result.classList.remove('hidden');
    $('status').textContent = String(status || 'WAITING').toUpperCase();
    $('message').textContent = message || '';
    $('code').textContent = code || '----';
    $('copy').classList.toggle('hidden', !code);
    $('cancel').classList.toggle('hidden', !requestId || status === 'connected');
  }
  async function call(path, options = {}) {
    if (!api || api.includes('YOUR-BACKEND-DOMAIN')) throw new Error('Pairing backend URL has not been configured yet.');
    const response = await fetch(api + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  function stopPolling() { if (poller) clearInterval(poller); poller = null; }
  async function poll() {
    if (!requestId) return;
    try {
      const data = await call('/api/status/' + encodeURIComponent(requestId));
      show(data.status, data.message, data.code);
      if (['connected','error','expired','cancelled','disconnected'].includes(data.status)) {
        stopPolling(); generate.disabled = false; generate.textContent = 'GENERATE NEW CODE ↗';
      }
    } catch (err) { show('error', err.message); stopPolling(); generate.disabled = false; }
  }
  generate.addEventListener('click', async () => {
    const number = $('number').value.replace(/\D/g, '');
    if (number.length < 8 || number.length > 15) return show('error', 'Enter a valid number including its country code.');
    stopPolling(); requestId = null; generate.disabled = true; generate.textContent = 'REQUESTING...';
    show('starting', 'Contacting SHADOW MD pairing service...');
    try {
      const data = await call('/api/pair', { method: 'POST', body: JSON.stringify({ number }) });
      requestId = data.requestId;
      show(data.status, data.message, data.code);
      poller = setInterval(poll, 2500); poll();
    } catch (err) {
      show('error', err.message); generate.disabled = false; generate.textContent = 'TRY AGAIN ↗';
    }
  });
  $('copy').addEventListener('click', async () => {
    const code = $('code').textContent.replace(/-/g, '');
    try { await navigator.clipboard.writeText(code); $('copy').textContent = 'COPIED'; }
    catch { $('message').textContent = 'Select and copy the code manually.'; }
  });
  $('cancel').addEventListener('click', async () => {
    if (!requestId) return;
    try { await call('/api/cancel', { method: 'POST', body: JSON.stringify({ requestId }) }); }
    catch (err) { $('message').textContent = err.message; }
    stopPolling(); requestId = null; generate.disabled = false; generate.textContent = 'GENERATE NEW CODE ↗';
    show('cancelled', 'Pairing request cancelled.');
  });
})();
