/**
 * Cloudflare Worker for Hermes Web Client
 *
 * Serves the SPA and proxies /api/* requests to the remote Hermes Dashboard,
 * converting the `X-Hermes-Token` header to the `hermes_session_at` cookie
 * (browsers can't set Cookie headers on cross-origin fetches).
 *
 * Auth flow:
 *   1. Client sends `X-Hermes-Token: <jwt>` + `X-Hermes-Target: <dashboard-url>`
 *   2. Worker converts header → `Cookie: hermes_session_at=<jwt>`
 *   3. Worker proxies to the target dashboard
 *   4. Response returned to client
 *
 * Static assets (HTML/JS/CSS) are served automatically by Cloudflare
 * Workers + Assets from the `dist/` directory.
 */

export interface Env {
	ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// API proxy — forward to dashboard with cookie injection
		if (url.pathname.startsWith('/api/')) {
			return handleApiProxy(request);
		}

		// Static assets (served by Cloudflare Workers + Assets)
		return env.ASSETS.fetch(request);
	},
};

async function handleApiProxy(request: Request): Promise<Response> {
	const targetUrl = request.headers.get('X-Hermes-Target');
	const token = request.headers.get('X-Hermes-Token');

	if (!targetUrl) {
		return new Response(
			JSON.stringify({ error: 'Missing X-Hermes-Target header' }),
			{
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}

	if (!token) {
		return new Response(
			JSON.stringify({ error: 'Missing X-Hermes-Token header' }),
			{
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}

	const reqUrl = new URL(request.url);
	const upstream = new URL(reqUrl.pathname + reqUrl.search, targetUrl);

	// Clone headers, replace auth mechanism
	const headers = new Headers(request.headers);
	headers.set('Cookie', `hermes_session_at=${token}`);
	headers.delete('X-Hermes-Token');
	headers.delete('X-Hermes-Target');

	// Remove hop-by-hop headers
	headers.delete('Host');

	const upstreamRequest = new Request(upstream.toString(), {
		method: request.method,
		headers,
		body:
			request.method === 'GET' || request.method === 'HEAD'
				? null
				: request.body,
		redirect: 'follow',
	});

	try {
		const response = await fetch(upstreamRequest);
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	} catch (err) {
		const message =
			err instanceof Error ? err.message : 'Failed to proxy request';
		return new Response(JSON.stringify({ error: message }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
