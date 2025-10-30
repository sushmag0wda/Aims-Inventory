// core/static/js/common.js
// Global centered toast message for all pages (always override)
(function(){
  window.showMessage = function(message, isError = false, options = {}) {
    try {
      // Normalize some common messages across pages
      try {
        if (typeof message === 'string' && /Items issued successfully/i.test(message)) {
          message = 'Books issued';
        }
      } catch(_) {}

      // Remove existing toasts
      document.querySelectorAll('.toast-message').forEach(n => n.remove());

      const toast = document.createElement('div');
      toast.className = 'toast-message';
      toast.textContent = String(message);
      toast.setAttribute('role', 'status');

      const duration = typeof options.duration === 'number' ? options.duration : 1500;

      Object.assign(toast.style, {
        position: 'fixed',
        left: '50%',
        top: '50%', // middle of viewport
        transform: 'translate(-50%, -50%)',
        zIndex: '2147483647', // ensure on top
        maxWidth: '80vw',
        padding: '14px 18px',
        borderRadius: '10px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        fontWeight: '600',
        textAlign: 'center',
        color: isError ? '#7f1d1d' : '#052e16',
        background: isError ? '#fee2e2' : '#dcfce7',
        border: `1px solid ${isError ? '#fecaca' : '#bbf7d0'}`,
        cursor: 'pointer'
      });

      document.body.appendChild(toast);

      const remove = () => { try { toast.remove(); } catch(_){} };
      const timeoutId = setTimeout(remove, duration);
      toast.addEventListener('click', () => { clearTimeout(timeoutId); remove(); });
    } catch (_) {
      if (isError) console.error(message); else console.log(message);
    }
  };
})();

// Landing page splash screen handling
(function(){
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLandingSplash);
  } else {
    initLandingSplash();
  }

  function initLandingSplash() {
    try {
      const splash = document.getElementById('landingSplash');
      const content = document.getElementById('landingContent');
      const loader = document.getElementById('landingLoader');
      const inner = document.getElementById('landingInner');
      if (!splash || !content || !loader || !inner) return;

      const splashDuration = 4500; // 4.5 seconds
      const loaderDuration = 900; // loader visible before content

      content.setAttribute('aria-hidden', 'true');
      loader.classList.add('visible');

      setTimeout(() => {
        splash.classList.add('hidden');
        splash.setAttribute('aria-hidden', 'true');
        content.classList.add('visible');
        content.setAttribute('aria-hidden', 'false');

        setTimeout(() => {
          loader.classList.add('hidden');
          loader.setAttribute('aria-hidden', 'true');
          inner.classList.add('visible');
          inner.setAttribute('aria-hidden', 'false');
        }, loaderDuration);
      }, splashDuration);
    } catch (err) {
      console.error('Landing splash init failed', err);
    }
  }
})();
