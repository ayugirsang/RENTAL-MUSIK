window.ritmeSupabaseClient = window.RITME_CONFIG && window.supabase?.createClient
  ? window.supabase.createClient(window.RITME_CONFIG.supabaseUrl, window.RITME_CONFIG.supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  })
  : null;

// Public mode: replace the old login gate with direct application startup.
// Database access must be enabled for the anon role by the accompanying SQL migration.
const registerDocumentListener = document.addEventListener.bind(document);
document.addEventListener = (type, listener, options) => {
  if (type === 'DOMContentLoaded' && listener?.name === 'initializeAuthentication') {
    listener = () => {
      document.querySelector('#auth-gate')?.remove();
      const appShell = document.querySelector('.app-shell');
      if (appShell) appShell.hidden = false;
      document.querySelector('#logout-button')?.remove();
      document.querySelector('#account-avatar')?.remove();
      initializeApplication();
    };
  }
  return registerDocumentListener(type, listener, options);
};
