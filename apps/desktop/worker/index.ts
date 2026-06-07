/**
 * Cloudflare Worker for Hermes Web Client
 *
 * Serves the SPA and proxies /api/* requests to the remote Hermes Dashboard,
 * converting the `X-Hermes-Token` header to the `hermes_session_at` cookie
 * (browsers can't set Cookie headers on cross-origin fetches).
 *
 * Auth flow:
 *   1. Client sends `X-Hermes-Token: <jwt>` (optionally `X-Hermes-Target`)
 *   2. Worker uses HERMES_DASHBOARD_URL env var (or X-Hermes-Target header)
 *   3. Worker converts token header -> `Cookie: hermes_session_at=<jwt>`
 *   4. Worker proxies to the target dashboard
 *   5. Response returned to client
 */

export interface Env {
	ASSETS: { fetch: (request: Request) => Promise<Response> };
	HERMES_DASHBOARD_URL: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.startsWith('/api/')) {
			return handleApiProxy(request, env);
		}

		return env.ASSETS.fetch(request);
	},
};

async function handleApiProxy(request: Request, env: Env): Promise<Response> {
	const targetUrl =
		request.headers.get('X-Hermes-Target') || env.HERMES_DASHBOARD_URL;
	const token = request.headers.get('X-Hermes-Token');

	if (!targetUrl) {
		return new Response(
			JSON.stringify({ error: 'No dashboard URL configured' }),
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

	const headers = new Headers(request.headers);
	headers.set('Cookie', `hermes_session_at=${token}`);
	headers.delete('X-Hermes-Token');
	headers.delete('X-Hermes-Target');
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
