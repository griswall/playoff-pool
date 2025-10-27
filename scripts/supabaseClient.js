const CONFIG_SCRIPT_ID = 'supabase-config';
const GLOBAL_CONFIG_KEY = '__SUPABASE_CONFIG__';

let supabaseClientInstance = null;
let cachedConfig = null;

function ensureSupabaseIsAvailable() {
  if (typeof supabase === 'undefined' || typeof supabase?.createClient !== 'function') {
    throw new Error('Supabase library has not been loaded.');
  }
}

function readConfigFromGlobal() {
  if (typeof window === 'undefined') {
    return {};
  }

  const globalConfig = window[GLOBAL_CONFIG_KEY];
  if (globalConfig && typeof globalConfig === 'object') {
    return { ...globalConfig };
  }

  return {};
}

function readConfigFromScriptTag() {
  if (typeof document === 'undefined') {
    return {};
  }

  const script = document.getElementById(CONFIG_SCRIPT_ID);
  if (!script) {
    return {};
  }

  try {
    const parsed = JSON.parse(script.textContent || '{}');
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (error) {
    console.error('Failed to parse Supabase configuration JSON.', error);
  }

  return {};
}

function normalizeAdminEmails(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate
    .map((email) => (typeof email === 'string' ? email.trim() : ''))
    .filter(Boolean);
}

function loadSupabaseConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  const mergedConfig = {
    ...readConfigFromScriptTag(),
    ...readConfigFromGlobal()
  };

  const url = typeof mergedConfig.url === 'string' ? mergedConfig.url.trim() : '';
  const anonKey = typeof mergedConfig.anonKey === 'string' ? mergedConfig.anonKey.trim() : '';
  const adminEmails = normalizeAdminEmails(mergedConfig.adminEmails);

  if (!url || !anonKey) {
    throw new Error(
      'Supabase configuration is missing. Provide `url` and `anonKey` via window.__SUPABASE_CONFIG__ or a #supabase-config script tag.'
    );
  }

  cachedConfig = Object.freeze({ url, anonKey, adminEmails });
  return cachedConfig;
}

export function getSupabaseConfig() {
  return loadSupabaseConfig();
}

export function getSupabaseClient() {
  if (supabaseClientInstance) {
    return supabaseClientInstance;
  }

  ensureSupabaseIsAvailable();

  const { url, anonKey } = loadSupabaseConfig();

  supabaseClientInstance = supabase.createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  return supabaseClientInstance;
}
