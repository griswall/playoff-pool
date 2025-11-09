const PLACEHOLDER_PATTERN = /^YOUR_/i;
let supabaseClientInstance = null;
let cachedConfig = null;
let cachedConfigError = null;

function normalizeAdminEmails(emails) {
  if (!Array.isArray(emails)) {
    return [];
  }

  return emails
    .filter((email) => typeof email === 'string')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

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
  const adminMeta = document.querySelector('meta[name="supabase-admin-emails"]');

  if (urlMeta?.content) {
    config.url = urlMeta.content;
  }
  if (keyMeta?.content) {
    config.anonKey = keyMeta.content;
  }
  if (adminMeta?.content) {
    config.adminEmails = adminMeta.content
      .split(',')
      .map((email) => email.trim())
      .filter((email) => email.length > 0);
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
    if (Array.isArray(source.adminEmails)) {
      acc.adminEmails = source.adminEmails;
    }
    return acc;
  }, { url: '', anonKey: '', adminEmails: [] });

  merged.url = (merged.url || '').trim();
  merged.anonKey = (merged.anonKey || '').trim();

  if (PLACEHOLDER_PATTERN.test(merged.url)) {
    merged.url = '';
  }
  if (PLACEHOLDER_PATTERN.test(merged.anonKey)) {
    merged.anonKey = '';
  }

  merged.adminEmails = normalizeAdminEmails(merged.adminEmails);

  if (!merged.url || !merged.anonKey) {
    const error = new Error('Supabase configuration is missing the project URL or anon key.');
    cachedConfigError = error;
    throw error;
  }

  cachedConfig = Object.freeze({
    url: merged.url,
    anonKey: merged.anonKey,
    adminEmails: Object.freeze([...merged.adminEmails])
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

export function isAdminEmail(email) {
  if (typeof email !== 'string') {
    return false;
  }
  const lowerCaseEmail = email.trim().toLowerCase();
  if (!lowerCaseEmail) {
    return false;
  }
  const config = resolveSupabaseConfig();
  return config.adminEmails.includes(lowerCaseEmail);
}

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
