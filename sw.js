/* Bid Boards has merged into the combined Bids app
   (https://sharmaelechvac.github.io/sharma-bids/).
   This worker exists only to retire the old one: it clears every cache
   the old app stored, unregisters itself, and reloads open pages so
   they fetch the redirect from the network. */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.registration.unregister(); })
      .then(function () { return self.clients.matchAll({ type: "window" }); })
      .then(function (clients) { clients.forEach(function (c) { c.navigate(c.url); }); })
  );
});
