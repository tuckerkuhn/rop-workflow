/**
 * What to tell the person when the server gave no message of its own: what happened and what to
 * do, never a bare status code. The server's own message (an `error` in the reply) always wins.
 */
export function plainError(status: number): string {
  if (status === 401) return "You are signed out. Sign in again, then repeat what you were doing.";
  if (status === 403) return "Your account cannot do this here. Ask your manager or an administrator if you should be able to.";
  if (status === 404) return "This could not be found. It may have been moved or removed: reload the page.";
  if (status === 409) return "Someone changed this since you opened the page. Reload the page and make your change again.";
  if (status === 413) return "That file is too large. Choose a smaller file, or a photo taken at lower quality.";
  if (status === 429) return "Too many tries in a short time. Wait a minute, then try again.";
  if (status >= 500) return "The server had a problem and nothing was saved. Try again in a minute; if it keeps happening, tell your administrator.";
  return "That did not work and nothing was saved. Reload the page and try again.";
}

/** When the request never reached the server: no connection, or it dropped. */
export const OFFLINE = "No connection to the server, so nothing was saved. Check the phone's internet, then try again.";

/** The message for a failed request: the server's, or a plain one from the status. */
export const errorText = (body: unknown, status: number) => (body as { error?: string } | null)?.error ?? plainError(status);
