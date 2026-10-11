window.ritmeSupabaseClient = window.RITME_CONFIG && window.supabase?.createClient
  ? window.supabase.createClient(window.RITME_CONFIG.supabaseUrl, window.RITME_CONFIG.supabasePublishableKey)
  : null;
