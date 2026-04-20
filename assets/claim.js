// ================================================================
// /claim.js
// Client logic for the self-claim portal.
// Two-step flow: form submit -> display code -> verify.
// ================================================================

(function () {
  const form = document.getElementById('claim-form');
  const step2 = document.getElementById('claim-step-2');
  const result = document.getElementById('claim-result');
  const codeDisplay = document.getElementById('claim-code');
  const platformLabel = document.getElementById('claim-platform-label');
  const verifyBtn = document.getElementById('claim-verify-btn');

  let currentCode = null;
  let currentPlatform = null;
  let currentHandle = null;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const platform = fd.get('platform');
    const handle = String(fd.get('handle')).trim();
    const email = String(fd.get('email') || '').trim();

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Requesting…';

    try {
      const res = await fetch('/api/claim/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, handle, email: email || undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        showResult(data.error || 'Unable to start claim.', 'error');
        return;
      }
      currentCode = data.verification_code;
      currentPlatform = platform;
      currentHandle = handle;
      codeDisplay.textContent = currentCode;
      platformLabel.textContent = platform === 'twitch' ? 'Twitch' : 'Kick';
      form.classList.add('hidden');
      step2.classList.remove('hidden');
    } catch (err) {
      showResult(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Get verification code';
    }
  });

  verifyBtn.addEventListener('click', async () => {
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Checking your bio…';
    try {
      const res = await fetch('/api/claim/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verification_code: currentCode }),
      });
      const data = await res.json();
      if (data.ok && data.verified) {
        step2.classList.add('hidden');
        showResult(
          `<h3>Verified.</h3><p>${escapeHtml(data.message)}</p>`,
          'success'
        );
      } else {
        showResult(data.error || 'Verification failed.', 'error');
      }
    } catch (err) {
      showResult(err.message, 'error');
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = "I've pasted it — Verify now";
    }
  });

  function showResult(html, kind) {
    result.className = `cl-claim-result cl-claim-result-${kind}`;
    result.innerHTML = html;
    result.classList.remove('hidden');
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
