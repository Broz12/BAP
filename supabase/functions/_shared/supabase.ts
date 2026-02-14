import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";

export function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function createAdminClient() {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export async function requireUser(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) {
    throw new Error("Missing authorization token.");
  }

  const client = createAdminClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    throw new Error("Unauthorized.");
  }

  return {
    user: data.user,
    adminClient: client
  };
}

export async function requireAdmin(request: Request) {
  const { user, adminClient } = await requireUser(request);

  const { data: profile, error } = await adminClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error || !profile || profile.role !== "admin") {
    throw new Error("Admin role required.");
  }

  return {
    user,
    adminClient
  };
}
