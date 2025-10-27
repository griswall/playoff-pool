const SUPABASE_URL = 'https://jlsudfmhsmxmxpdtkrzr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsc3VkZm1oc214bXhwZHRrcnpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNDQxNjEsImV4cCI6MjA3NjcyMDE2MX0.zJrz82WArsyFLybmGsxkOAr9HBoHrFhfa2pHwqvojxk';

const SUPABASE_CONFIG = Object.freeze({
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY
});

let supabaseClientInstance = null;

function ensureSupabaseIsAvailable() {
  if (typeof supabase === 'undefined' || !supabase?.createClient) {
    throw new Error('Supabase library has not been loaded.');
  }
}

export function getSupabaseClient() {
  if (supabaseClientInstance) {
    return supabaseClientInstance;
  }

  ensureSupabaseIsAvailable();

  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
    throw new Error('Supabase configuration is missing the project URL or anon key.');
  }

  supabaseClientInstance = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  return supabaseClientInstance;
}

export { SUPABASE_CONFIG };
