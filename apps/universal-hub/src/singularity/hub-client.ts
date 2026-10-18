/** Thin client for a configured Quantum hub.
 * The preview works with no hub. Passwords are sent only to the address
 * the person typed, and never written to logs or storage.
 */

export type HubResult<T> = { ok: true; data: T } | { ok: false; error: string };

function cleanBase(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export async function hubSignIn(hubUrl: string, email: string, password: string): Promise<HubResult<{ email: string }>> {
  const base = cleanBase(hubUrl);
  if (!base) return { ok: false, error: "Enter a hub address that starts with https." };
  if (!email.trim() || !password) return { ok: false, error: "Email and password are both required." };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(new URL("/api/auth/login", base), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `Hub refused sign-in (${res.status}).` };
    }
    return { ok: true, data: { email: email.trim() } };
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError" ? "Hub did not answer in time." : "Could not reach the hub.";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
