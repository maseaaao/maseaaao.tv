// Donor panel Worker. Runs on workers.dev, where outbound requests to
// DonationAlerts are not blocked by the site zone's egress. Serves the page and
// its data; the widget URL with the token lives only in the DA_WIDGET_URL secret.

import donorCss from '../../../dist/obs-widgets/donors/donationalerts-stream-stats.css';
import { collectWidget, renderPage } from '../../../tooling/donors-page';

const BASE_PATH = '/live/da/top';
const INTERVAL_MS = 6000;

interface Env {
  DA_WIDGET_URL?: string;
}

function headers(contentType: string, maxAge: number): Record<string, string> {
  return {
    'Cache-Control': `public, max-age=${maxAge}`,
    'Content-Type': contentType,
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === BASE_PATH) {
      return new Response(renderPage({ css: donorCss, dataUrl: `${BASE_PATH}/data` }), {
        headers: headers('text/html; charset=utf-8', 300),
      });
    }
    if (pathname === `${BASE_PATH}/data`) {
      if (!env.DA_WIDGET_URL) {
        return notFound();
      }
      try {
        const { payload } = await collectWidget(env.DA_WIDGET_URL, INTERVAL_MS);
        return new Response(JSON.stringify(payload), {
          headers: headers('application/json; charset=utf-8', 15),
        });
      } catch (error) {
        // Do not log the request URL: it contains the widget token.
        console.error(
          `Donor data failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return new Response('Donor data is unavailable', { status: 502 });
      }
    }
    return notFound();
  },
};
