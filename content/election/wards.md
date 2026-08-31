---
title: "Find Your Ward — Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Find Your Ward</p>

# Find your ward

The 2022-2026 council term (and its ward boundaries) remains legally in effect until Nov 15, 2026. The Oct 26, 2026 election is run on the REDRAWN 2026 ward boundaries, which is why a voter's 'current representative' and 'who's on your ballot' can point at two different ward numbers for the same address.

<div class="eh-ward-finder" data-eh-ward-finder>
  <label for="eh-address-input" class="eh-ward-finder-label">Look up an address (London, ON)</label>
  <div class="eh-ward-finder-row">
    <input id="eh-address-input" class="eh-ward-finder-input" type="text" placeholder="e.g. 300 Dufferin Ave" autocomplete="off" />
    <button id="eh-address-submit" class="eh-ward-finder-button" type="button">Find my ward</button>
  </div>
  <p id="eh-ward-finder-status" class="eh-ward-finder-status" role="status" aria-live="polite"></p>
  <div id="eh-ward-finder-result" class="eh-ward-finder-result" hidden></div>
  <p class="eh-ward-finder-fallback">This looks up your address against the City of London's live ward map. If it doesn't respond, use the ward table below, or the City's own <a href="https://london.ca/government/council-civic-administration/elections">ward map tool</a>.</p>
</div>

## All 14 wards

<div class="eh-table-scroll">

| Ward | Current representative (2022–2026) | 2026 boundary | 2026 ballot note |
|:---:|---|:---:|---|
| 1 | [Hadleigh McAlister](/election/councillors/h-mcalister) | Changed | — |
| 2 | [Shawn Lewis](/election/councillors/s-lewis) | Same shape | — |
| 3 | [Peter Cuddy](/election/councillors/p-cuddy) | Changed | — |
| 4 | [Susan Stevenson](/election/councillors/s-stevenson) | Changed | No outgoing Ward 4 councillor appears on the 2026 Ward 4 ballot. Susan Stevenson, the outgoing Ward 4 councillor, is a certified candidate for Mayor in the Oct 26, 2026 election. |
| 5 | [Jerry Pribil](/election/councillors/j-pribil) | Changed | Jerry Pribil does not appear on the 2026 certified list of candidates for any ward or for Mayor (list checked 2026-08-30). Corrine Rahman, the outgoing Ward 7 councillor, is listed as a candidate in this ward under the new boundaries. |
| 6 | [Sam Trosow](/election/councillors/s-trosow) | Same shape | — |
| 7 | [Corrine Rahman](/election/councillors/c-rahman) | Changed | Corrine Rahman, the outgoing Ward 7 councillor, has filed to run in the new Ward 5 instead of Ward 7. No outgoing Ward 7 councillor appears on the 2026 Ward 7 ballot. |
| 8 | [Steve Lehman](/election/councillors/s-lehman) | Same shape | — |
| 9 | [Anna Hopkins](/election/councillors/a-hopkins) | Same shape | — |
| 10 | [Paul Van Meerbergen](/election/councillors/p-van-meerbergen) | Same shape | — |
| 11 | [Skylar Franke](/election/councillors/s-franke) | Same shape | — |
| 12 | [Elizabeth Peloza](/election/councillors/e-peloza) | Changed | — |
| 13 | [David Ferreira](/election/councillors/d-ferreira) | Same shape | — |
| 14 | [Steve Hillier](/election/councillors/s-hillier) | Changed | Steve Hillier does not appear on the 2026 certified list of candidates for any ward or for Mayor (list checked 2026-08-30). No outgoing Ward 14 councillor appears on the 2026 Ward 14 ballot. |

</div>

For wards not flagged above, this data does not assert that the outgoing councillor is running again in 2026 — only that no change was found in this pass. Boundary shape changed for Wards 1, 3, 4, 5, 7, 12 and 14 even where the incumbent is unaffected, per the City's Ward Boundary Review. Always check the official certified candidate list linked above for who is actually on your ballot.

For the authoritative, official candidate list for every ward, see the City Clerk's [certified list of candidates](https://london.ca/sites/default/files/2026-08/2026%20CERTIFIED%20LIST%20OF%20CANDIDATES.pdf) (checked 2026-08-30 (certified list, nominations closed Aug 21 2026, list last modified Aug 28 2026)). Per this hub's scope, only current councillors get a stance profile here — challengers don't have a council voting record to summarize.

<script>
(function () {
  "use strict";
  var WARDS_2022 = 8; // MapServer layer id, "Election 2022 Wards" — currently in effect until Nov 15, 2026
  var WARDS_2026 = 9; // MapServer layer id, "Election 2026 Wards" — the boundaries used for the Oct 26, 2026 ballot
  var BASE = "https://maps.london.ca/server/rest/services";
  var GEOCODE_URL = BASE + "/Locators/SearchKeyCompositeLocator/GeocodeServer/findAddressCandidates";
  var WARD_QUERY_URL = function (layer) { return BASE + "/OpenData/OpenData_Elections/MapServer/" + layer + "/query"; };
  var TIMEOUT_MS = 7000;
  var REPS = {"1":{"slug":"h-mcalister","name":"Hadleigh McAlister","note2026":null},"2":{"slug":"s-lewis","name":"Shawn Lewis","note2026":null},"3":{"slug":"p-cuddy","name":"Peter Cuddy","note2026":null},"4":{"slug":"s-stevenson","name":"Susan Stevenson","note2026":"No outgoing Ward 4 councillor appears on the 2026 Ward 4 ballot. Susan Stevenson, the outgoing Ward 4 councillor, is a certified candidate for Mayor in the Oct 26, 2026 election."},"5":{"slug":"j-pribil","name":"Jerry Pribil","note2026":"Jerry Pribil does not appear on the 2026 certified list of candidates for any ward or for Mayor (list checked 2026-08-30). Corrine Rahman, the outgoing Ward 7 councillor, is listed as a candidate in this ward under the new boundaries."},"6":{"slug":"s-trosow","name":"Sam Trosow","note2026":null},"7":{"slug":"c-rahman","name":"Corrine Rahman","note2026":"Corrine Rahman, the outgoing Ward 7 councillor, has filed to run in the new Ward 5 instead of Ward 7. No outgoing Ward 7 councillor appears on the 2026 Ward 7 ballot."},"8":{"slug":"s-lehman","name":"Steve Lehman","note2026":null},"9":{"slug":"a-hopkins","name":"Anna Hopkins","note2026":null},"10":{"slug":"p-van-meerbergen","name":"Paul Van Meerbergen","note2026":null},"11":{"slug":"s-franke","name":"Skylar Franke","note2026":null},"12":{"slug":"e-peloza","name":"Elizabeth Peloza","note2026":null},"13":{"slug":"d-ferreira","name":"David Ferreira","note2026":null},"14":{"slug":"s-hillier","name":"Steve Hillier","note2026":"Steve Hillier does not appear on the 2026 certified list of candidates for any ward or for Mayor (list checked 2026-08-30). No outgoing Ward 14 councillor appears on the 2026 Ward 14 ballot."}};

  function jsonp(url, params, onSuccess, onError) {
    var cbName = "eh_cb_" + Math.random().toString(36).slice(2);
    var script = document.createElement("script");
    var timer = setTimeout(function () {
      cleanup();
      onError(new Error("timed out"));
    }, TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (data) {
      cleanup();
      onSuccess(data);
    };

    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    script.src = url + "?" + qs + "&callback=" + cbName;
    script.onerror = function () {
      cleanup();
      onError(new Error("script load failed"));
    };
    document.head.appendChild(script);
  }

  function findWard(lon, lat, layer, cb) {
    jsonp(WARD_QUERY_URL(layer), {
      f: "json",
      geometry: lon + "," + lat,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      outFields: "Ward"
    }, function (data) {
      var feature = data && data.features && data.features[0];
      cb(feature ? feature.attributes.Ward : null);
    }, function (err) { cb(null, err); });
  }

  // Ward numbers come back from a third-party (City of London) server via
  // JSONP. Validate the shape before using them at all, and build the
  // result with DOM APIs (textContent / element properties) rather than
  // innerHTML, so nothing from that response is ever parsed as markup.
  var WARD_RE = /^([1-9]|1[0-4])$/;
  function safeWard(w) {
    return typeof w === "string" && WARD_RE.test(w) ? w : null;
  }

  function el(tag, opts) {
    var node = document.createElement(tag);
    if (opts) {
      if (opts.text !== undefined) node.textContent = opts.text;
      if (opts.className) node.className = opts.className;
      if (opts.href) { node.href = opts.href; }
    }
    return node;
  }

  function renderResult(container, ward2022Raw, ward2026Raw) {
    var ward2022 = safeWard(ward2022Raw);
    var ward2026 = safeWard(ward2026Raw);
    var rep2022 = ward2022 ? REPS[ward2022] : null;
    var rep2026Note = ward2026 && REPS[ward2026] ? REPS[ward2026].note2026 : null;

    while (container.firstChild) container.removeChild(container.firstChild);
    var any = false;

    if (ward2022) {
      any = true;
      var p1 = el("p");
      p1.appendChild(el("strong", { text: "Your current representative (Ward " + ward2022 + "):" }));
      if (rep2022) {
        p1.appendChild(document.createTextNode(" "));
        var a = el("a", { text: rep2022.name, href: "/election/councillors/" + rep2022.slug });
        p1.appendChild(a);
      }
      container.appendChild(p1);
    }

    if (ward2026) {
      any = true;
      var p2 = el("p");
      p2.appendChild(el("strong", { text: "Your Oct 26, 2026 ballot ward: " }));
      p2.appendChild(document.createTextNode("Ward " + ward2026));
      if (ward2022 && ward2022 !== ward2026) {
        p2.appendChild(document.createTextNode(" "));
        p2.appendChild(el("em", { text: "(different from your current ward — boundaries changed here)" }));
      }
      container.appendChild(p2);
      if (rep2026Note) {
        container.appendChild(el("p", { className: "eh-ward-finder-note", text: rep2026Note }));
      }
    }

    if (!any) {
      container.appendChild(el("p", { text: "Couldn't match that address to a ward. Try a more specific address, or use the table below." }));
    }
    container.hidden = false;
  }

  function run() {
    var input = document.getElementById("eh-address-input");
    var button = document.getElementById("eh-address-submit");
    var status = document.getElementById("eh-ward-finder-status");
    var result = document.getElementById("eh-ward-finder-result");
    if (!input || !button || !status || !result) return;

    function submit() {
      var address = input.value.trim();
      if (!address) return;
      status.textContent = "Looking up \"" + address + "\"…";
      result.hidden = true;

      jsonp(GEOCODE_URL, { SingleLine: address + ", London, ON", f: "json", outSR: 4326 }, function (data) {
        var candidate = data && data.candidates && data.candidates[0];
        if (!candidate || candidate.score < 70) {
          status.textContent = "Couldn't find that address. Try including a street number and name.";
          return;
        }
        var lon = candidate.location.x;
        var lat = candidate.location.y;
        var done = 0, ward2022 = null, ward2026 = null;
        function maybeFinish() {
          done++;
          if (done === 2) {
            status.textContent = "";
            renderResult(result, ward2022, ward2026);
          }
        }
        findWard(lon, lat, WARDS_2022, function (w) { ward2022 = w; maybeFinish(); });
        findWard(lon, lat, WARDS_2026, function (w) { ward2026 = w; maybeFinish(); });
      }, function () {
        status.textContent = "The City's address lookup didn't respond. Use the ward table below instead.";
      });
    }

    button.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
</script>
