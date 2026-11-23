// The site redirects the donor panel to workers.dev: requests from the
// maseaaao.tv zone fail against DonationAlerts with a 525 TLS error, while the
// same Worker on workers.dev succeeds. The static site-link widget is served
// from this Worker directly (its CSS and font are already inlined).

import siteLinkHtml from '../../../dist/obs-widgets/site-link/index.html';

const DONOR_PAGE = '/live/da/top';
const DONORS_URL = 'https://maseaaao-donors.mvbureev.workers.dev/live/da/top';
const SITE_LINK_PAGES = new Set(['/site-link', '/site-link/', '/live/site']);

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (pathname === DONOR_PAGE) {
      return Response.redirect(DONORS_URL, 302);
    }
    if (SITE_LINK_PAGES.has(pathname)) {
      return new Response(siteLinkHtml, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/html; charset=utf-8',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      });
    }
    return new Response('Not found', { status: 404 });
  },
};
