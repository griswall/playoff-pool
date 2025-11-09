const PLACEHOLDER_PATTERN = /^YOUR_/i;
let supabaseClientInstance = null;
let cachedConfig = null;
let cachedConfigError = null;

function parseConfigFromScript() {
  if (typeof document === 'undefined') {
    return {};
  }

  const scriptEl = document.getElementById('supabase-config');
  if (!scriptEl) {
    return {};
  }

  try {
    const parsed = JSON.parse(scriptEl.textContent || '{}');
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (error) {
    console.error('Failed to parse Supabase configuration JSON.', error);
    throw new Error('Invalid Supabase configuration JSON.');
  }

  return {};
}

function parseConfigFromMetaTags() {
  if (typeof document === 'undefined') {
    return {};
  }

  const config = {};
  const urlMeta = document.querySelector('meta[name="supabase-url"]');
  const keyMeta = document.querySelector('meta[name="supabase-anon-key"]');

  if (urlMeta?.content) {
    config.url = urlMeta.content;
  }
  if (keyMeta?.content) {
    config.anonKey = keyMeta.content;
  }
  
  return config;
}

function resolveSupabaseConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  if (cachedConfigError) {
    throw cachedConfigError;
  }

  const sources = [];

  if (typeof window !== 'undefined' && window.__SUPABASE_CONFIG__) {
    sources.push(window.__SUPABASE_CONFIG__);
  }

  try {
    sources.push(parseConfigFromScript());
  } catch (error) {
    cachedConfigError = error;
    throw error;
  }

  sources.push(parseConfigFromMetaTags());

  const merged = sources.reduce((acc, source) => {
    if (!source || typeof source !== 'object') {
      return acc;
    }

    if (typeof source.url === 'string') {
      acc.url = source.url;
    }
    if (typeof source.anonKey === 'string') {
      acc.anonKey = source.anonKey;
    }
    return acc;
  }, { url: '', anonKey: '' });

  merged.url = (merged.url || '').trim();
  merged.anonKey = (merged.anonKey || '').trim();

  if (PLACEHOLDER_PATTERN.test(merged.url)) {
    merged.url = '';
  }
  if (PLACEHOLDER_PATTERN.test(merged.anonKey)) {
    merged.anonKey = '';
  }

  if (!merged.url || !merged.anonKey) {
    const error = new Error('Supabase configuration is missing the project URL or anon key.');
    cachedConfigError = error;
    throw error;
  }

  cachedConfig = Object.freeze({
    url: merged.url,
    anonKey: merged.anonKey
  });

  return cachedConfig;
}

function ensureSupabaseIsAvailable() {
  if (typeof supabase === 'undefined' || !supabase?.createClient) {
    throw new Error('Supabase library has not been loaded.');
  }
}

export function getSupabaseConfig() {
  return resolveSupabaseConfig();
}

// --- NEW SECURE ADMIN CHECK ---
let isAdminCache = null;

/**
 * Checks if the current authenticated user is an admin by calling a secure database function.
 * Caches the result for the session.
 */
export async function checkIsAdmin() {
  // Return cached result if we've checked before
  if (isAdminCache !== null) {
    return isAdminCache;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('is_admin_user');

  if (error) {
    console.error("Error checking admin status:", error.message);
    isAdminCache = false; // Cache failure as false
    return false;
  }

  isAdminCache = data; // Cache success
  return data;
}

/**
 * Clears the admin status cache. This must be called on logout.
 */
export function clearAdminCache() {
  isAdminCache = null;
}
// --- END NEW SECURE ADMIN CHECK ---


export function getSupabaseClient() {
  if (supabaseClientInstance) {
    return supabaseClientInstance;
  }

  const config = resolveSupabaseConfig();
  ensureSupabaseIsAvailable();

  supabaseClientInstance = supabase.createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  return supabaseClientInstance;
}

export const SUPABASE_CONFIG = new Proxy(
  {},
  {
    get: (_, property) => {
      const config = resolveSupabaseConfig();
      return config[property];
    },
    ownKeys: () => Reflect.ownKeys(resolveSupabaseConfig()),
    getOwnPropertyDescriptor: (_, property) =>
      Object.getOwnPropertyDescriptor(resolveSupabaseConfig(), property)
  }
);
