/**
 * Proxy SacPassport so GitHub Pages sees Cloudflare egress, not Meta's IP.
 * Custom-domain requests from facebookexternalhit get 403 at origin when
 * CF-Connecting-IP is Meta; Worker subrequests do not forward that header.
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const ua = request.headers.get("user-agent") || "";

    const headers = {
      Host: "sacpassport.com",
      "User-Agent": ua || "Cloudflare-Worker",
      Accept: request.headers.get("Accept") || "*/*",
    };

    // Hit a GitHub Pages anycast IP with the custom Host. TCP source is CF.
    const ips = [
      "185.199.108.153",
      "185.199.109.153",
      "185.199.110.153",
      "185.199.111.153",
    ];
    let lastErr;
    for (const ip of ips) {
      try {
        const resp = await fetch(`https://${ip}${url.pathname}${url.search}`, {
          method: "GET",
          headers,
          redirect: "manual",
        });
        if (resp.status === 403) continue;
        const out = new Headers(resp.headers);
        out.set("x-sacpassport-worker", "1");
        return new Response(resp.body, { status: resp.status, headers: out });
      } catch (e) {
        lastErr = e;
      }
    }
    return new Response("Origin fetch failed: " + String(lastErr || "403"), {
      status: 502,
    });
  },
};
