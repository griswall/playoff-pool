// =================================================================================
// --- CONFIGURATION ---
// =================================================================================

// REPLACE THIS WITH YOUR ACTUAL SUPABASE ANON KEY
const SUPABASE_URL = "https://jlsudfmhsmxmxpdtkrzr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsc3VkZm1oc214bXhwZHRrcnpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNDQxNjEsImV4cCI6MjA3NjcyMDE2MX0.zJrz82WArsyFLybmGsxkOAr9HBoHrFhfa2pHwqvojxk"; 

// =================================================================================
// --- CLIENT INITIALIZATION ---
// =================================================================================

let supabaseClientInstance = null;
let isAdminCache = null;

function ensureSupabaseIsAvailable() {
  if (typeof supabase === 'undefined' || !supabase?.createClient) {
    throw new Error('Supabase library has not been loaded. Make sure the CDN script tag is in your HTML.');
  }
}

export function getSupabaseClient() {
  if (supabaseClientInstance) {
    return supabaseClientInstance;
  }

  ensureSupabaseIsAvailable();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("YOUR_ANON_KEY")) {
    console.error("Supabase configuration is missing or invalid in scripts/supabaseClient.js");
    return null;
  }

  supabaseClientInstance = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  return supabaseClientInstance;
}

// =================================================================================
// --- ADMIN UTILITIES ---
// =================================================================================

/**
 * Checks if the current authenticated user is an admin by calling a secure database function.
 * Caches the result for the session.
 */
export async function checkIsAdmin() {
  // Return cached result if we've checked before
  if (isAdminCache !== null) {
    return isAdminCache;
  }

  const client = getSupabaseClient();
  if (!client) return false;

  const { data, error } = await client.rpc('is_admin_user');

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
