/**
 * Content-Security-Policy (HAD-79 / NFR-1 / R-2).
 *
 * SEC-3 argued against having a CSP at all, and that argument was right at the
 * time: every rendered string originated in this repository, React escapes by
 * default, there is no `dangerouslySetInnerHTML` anywhere, and a header with
 * `unsafe-inline` on scripts implies a protection it does not provide. Absent
 * beat misleadingly present.
 *
 * M3 changes the premise. Transaction descriptions come out of an LLM reading a
 * bank statement (HAD-9), and those strings render into the ledger, the review
 * inbox, the calendar and the report. The threat is not a hacker attacking the
 * app — it is a PDF containing text engineered to be echoed back, passed
 * through a model that is not a sanitiser, onto a page showing someone's bank
 * balance. React's escaping remains the primary defence. This is the second
 * layer, and second layers earn their cost exactly when untrusted content
 * enters the pipeline.
 */

/**
 * Per-request nonce.
 *
 * `crypto.randomUUID()` from the Web Crypto global rather than `node:crypto` —
 * middleware runs on the Edge runtime, where the node module is not available.
 */
export function makeNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * Whether the policy is trialled or enforced — **one switch, read twice**.
 *
 * It picks the response header name *and* drops the directives that are inert
 * in report-only mode. Two separate flags would be two places to disagree, and
 * the disagreement would be invisible: a policy that reports correctly while
 * claiming to enforce is exactly the kind of confident-but-wrong artefact this
 * project keeps producing.
 *
 * HAD-79 says trial first. An enforcing policy that is wrong does not warn —
 * it blanks a screen somebody opened to check a legal deadline.
 */
export const CSP_REPORT_ONLY = true;

/**
 * The policy, given a nonce.
 *
 * Every directive below is either the tightest value the app can actually run
 * under, or carries a reason it is not.
 */
export function cspFor(nonce: string): string {
  return [
    // Nothing loads from anywhere but this origin unless named below.
    `default-src 'self'`,

    /*
     * The directive this whole issue is about. No `unsafe-inline`.
     *
     * `strict-dynamic` is what makes the nonce workable: Next's App Router
     * emits a small nonced bootstrap that then loads the route chunks, and
     * without `strict-dynamic` every one of those chunk URLs would have to be
     * enumerated. With it, script loaded *by* already-trusted script inherits
     * trust, and the host-source fallbacks are ignored by browsers that
     * understand it — which is why `'self'` is still listed, for those that
     * do not.
     */
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,

    /*
     * `unsafe-inline` here, deliberately, and it is not the thing HAD-79
     * forbids — that prohibition is specific to `script-src`, for good reason.
     *
     * This codebase styles with React's `style={{…}}`, which renders a `style`
     * attribute, and Next inlines critical CSS as a `<style>` element. Nonces
     * cannot reach either. The residual risk is CSS injection — exfiltration
     * via attribute selectors and background-image URLs — which `default-src`
     * already confines to this origin, and which is a different order of
     * severity from script execution.
     *
     * Stating it rather than hiding it: this directive is a compromise. The
     * script one is not.
     */
    `style-src 'self' 'unsafe-inline'`,

    // `data:` covers the inline SVG icon. No remote images anywhere.
    `img-src 'self' data:`,

    // Self-hosted only. HAD-65's variable-font work must stay that way.
    `font-src 'self'`,

    /*
     * `'self'` alone, which is tighter than it looks and worth recording why:
     * there is **no browser-side Supabase client in this app**. Every database
     * call goes through a server action or a server component, so the browser
     * never opens a connection to the Supabase origin and does not need
     * permission to. If a `createBrowserClient` ever appears, this directive is
     * what will fail first — which is the correct place to find out.
     */
    `connect-src 'self'`,

    /*
     * The service worker (HAD-30), stated explicitly rather than left to fall
     * back.
     *
     * `worker-src` falls back to `child-src` and then to `script-src`, and
     * `script-src` here carries `'nonce-…' 'strict-dynamic'`. A worker script
     * cannot carry a nonce, and under `strict-dynamic` the `'self'`
     * host-source is ignored — so the fallback is at best ambiguous and at
     * worst a refusal to register `sw.js` at all. Push delivery and
     * installability both depend on that registration.
     *
     * **This is not currently proven by a test, and the honest note is that I
     * tried.** Deleting this line and re-running the e2e suite changes nothing:
     * registration still succeeds and no console error appears, because the
     * policy is Report-Only (`CSP_REPORT_ONLY = true`) and a report-only
     * violation blocks nothing. So the directive is reasoning about what
     * happens when the switch flips, not a measured result.
     *
     * That makes it exactly the thing to re-check when the policy is enforced:
     * if `worker-src` is wrong, the symptom will be push silently never
     * arriving, which is indistinguishable from having no cheques due.
     */
    `worker-src 'self'`,

    // The manifest is same-origin and would otherwise fall back to default-src.
    // Stated because installability is an acceptance criterion, not a nicety.
    `manifest-src 'self'`,

    // Matches X-Frame-Options: DENY, which older browsers use instead.
    `frame-ancestors 'none'`,

    // No plugins, no <base> rewriting, no posting this app's forms elsewhere.
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,

    // Nothing here is embedded, and nothing should be.
    `frame-src 'none'`,

    /*
     * Upgrade any stray http:// subresource rather than letting it load — but
     * only once the policy is enforced. The directive does nothing in a
     * report-only policy, and Chromium says so on every page load:
     *
     *   The Content Security Policy directive 'upgrade-insecure-requests' is
     *   ignored when delivered in a report-only policy.
     *
     * That is logged as a console *error*, so leaving it in would have fired on
     * all ten screens and buried any genuine violation in noise the policy
     * generated about itself. The e2e suite caught it, which is the argument
     * for trialling in the first place.
     */
    ...(CSP_REPORT_ONLY ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/**
 * The response header name, derived from the one switch above.
 *
 * The *request* header is set to the enforcing name regardless of this; see
 * `middleware.ts` for why that difference is load-bearing rather than an
 * oversight.
 */
export const CSP_RESPONSE_HEADER = CSP_REPORT_ONLY
  ? 'Content-Security-Policy-Report-Only'
  : 'Content-Security-Policy';
