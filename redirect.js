// contorina.naklitechie.com is retired (2026-11-12): contorina ships only inside NakliOS. Old links land on the
// same app at https://naklios.dev/apps/contorina/, with the rest of the path and the query kept. 302, not 301,
// so the decision stays reversible without stale browser caches.
export default {
  fetch(request) {
    const url = new URL(request.url);
    const rest = url.pathname.replace(/^\/+/, '');
    return Response.redirect(`https://naklios.dev/apps/contorina/${rest}${url.search}`, 302);
  },
};
