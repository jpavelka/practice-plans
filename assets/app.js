/* Practice Plan -- static single-page app over data/site.json.
 *
 * Hash routing (#/drill/x) rather than path routing on purpose: GitHub Pages
 * has no rewrite rules, so /drill/x would 404 on refresh or a shared link.
 *
 * All data goes through el()/text nodes, never innerHTML -- drill text is
 * transcribed from third-party PDFs and is not trusted markup.
 */
(() => {
  "use strict";

  const app = document.getElementById("app");
  const lightbox = document.getElementById("lightbox");
  const pagerEl = document.getElementById("pager");
  const menuEl = document.getElementById("menu");

  // ---------- theme (light / dark / system) ----------
  // No stored choice = "system". Applied first, before anything else touches
  // the DOM, so there's no flash of the wrong palette on load.
  (() => {
    const KEY = "theme";
    const root = document.documentElement;
    const meta = document.getElementById("theme-color-meta");
    const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
    const isDark = (choice) => choice === "dark" || (choice === "system" && darkMQ.matches);

    function apply(choice) {
      if (choice === "light" || choice === "dark") root.setAttribute("data-theme", choice);
      else root.removeAttribute("data-theme");
      meta.setAttribute("content", isDark(choice) ? "#0b1120" : "#166534");
      for (const b of document.querySelectorAll(".theme-switch button")) {
        b.setAttribute("aria-pressed", String(b.dataset.theme === choice));
      }
    }

    function choose(choice) {
      if (choice === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
      apply(choice);
    }

    apply(localStorage.getItem(KEY) || "system");
    darkMQ.addEventListener("change", () => {
      if (!localStorage.getItem(KEY)) apply("system");
    });
    document.querySelector(".theme-switch").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-theme]");
      if (b) choose(b.dataset.theme);
    });
  })();

  // The drill page pins its heading directly under the header, so it needs the
  // header's real height. That varies with the safe-area inset and with font
  // scaling, so measure it rather than hard-coding: publish as --topbar-h and
  // keep it current across rotation and resize.
  const topbarEl = document.querySelector(".topbar");
  const syncTopbarHeight = () => document.documentElement.style
    .setProperty("--topbar-h", `${topbarEl.offsetHeight}px`);
  new ResizeObserver(syncTopbarHeight).observe(topbarEl);
  syncTopbarHeight();

  let DATA = null;

  // ---------- tiny DOM helper ----------

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    // flat(Infinity): views build nested arrays (e.g. [", ", <a>] per entry),
    // and a single-level flatten would append a raw Array as a text node.
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  const render = (...nodes) => {
    app.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
  };

  /** The header is a fixed wordmark -- showing the current view's name there too
   *  just duplicates the <h2> on screen. Put it in the tab/history title, where
   *  it's genuinely useful and not visible twice. */
  const setTitle = (name) => {
    document.title = name ? `${name} · Practice Plans` : "Practice Plans";
  };

  function list(tag, cls, items) {
    return el(tag, { class: cls }, items.map((t) => el("li", {}, linkifyUrls(t))));
  }

  /** Transcribed drill text sometimes carries a bare URL (e.g. a YouTube link
   *  after an instruction). Split it into text/<a> pieces for el() rather than
   *  showing the raw URL -- a short label is a much easier mobile tap target. */
  const URL_RE = /https?:\/\/\S+/g;
  function linkifyUrls(text) {
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(URL_RE)) {
      const before = text.slice(last, m.index).replace(/\s+$/, "");
      if (before) parts.push(before);
      if (parts.length) parts.push(" ");
      parts.push(el("a", { href: m[0], text: "▶ Watch", target: "_blank", rel: "noopener noreferrer" }));
      last = m.index + m[0].length;
    }
    const after = text.slice(last);
    if (after) parts.push(after);
    return parts.length ? parts : text;
  }

  // ---------- data helpers ----------

  const drill = (id) => DATA.drills[id];
  const week = (id) => DATA.weeks.find((w) => w.id === id) || DATA.weeks[0];

  function weekLabel(w) {
    return w.weekOf || w.weekOfRaw || w.id;
  }

  /** Parse "YYYY-MM-DD" as a local date -- new Date("YYYY-MM-DD") parses as UTC
   *  midnight, which off-by-ones to the previous day in negative-UTC timezones. */
  function parseLocalDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDate(iso) {
    return parseLocalDate(iso)
      .toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }

  /** "YYYY-MM-DD" for local today, comparable against session.date strings. */
  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Every (week, session) with a practice date, newest first. */
  function practiceDates() {
    const out = [];
    for (const w of DATA.weeks) {
      w.sessions.forEach((s, idx) => {
        if (s.date) out.push({ week: w, session: s, sessionIdx: idx });
      });
    }
    return out.sort((a, b) => b.session.date.localeCompare(a.session.date));
  }

  /** Every (week, session) pair that schedules this drill. */
  function usedIn(drillId) {
    const out = [];
    for (const w of DATA.weeks) {
      w.sessions.forEach((s, idx) => {
        if (s.items.some((i) => i.drillId === drillId)) {
          out.push({ week: w, session: s, sessionIdx: idx });
        }
      });
    }
    return out;
  }

  // ---------- views ----------

  function practiceRow({ week: w, session: s, sessionIdx: si }) {
    return el("li", {},
      el("a", { class: "drill-link", href: `#/week/${enc(w.id)}/${si}` },
        el("span", { class: "body" },
          el("span", { class: "name", text: formatDate(s.date) }),
          w.theme ? el("span", { class: "note", text: w.theme }) : null),
        el("span", { class: "chev", text: "›" })));
  }

  /** Collapsible group of practices; omitted entirely when empty. */
  function practiceGroup(label, items, open) {
    if (!items.length) return null;
    return el("details", { class: "practice-group", open: open ? "" : null },
      el("summary", {},
        el("span", { class: "group-label", text: label }),
        el("span", { class: "group-count", text: String(items.length) })),
      el("ol", { class: "drills" }, items.map(practiceRow)));
  }

  function viewHome() {
    setTitle(null);

    const dates = practiceDates(); // newest first
    if (!dates.length) {
      render(el("h2", { text: "Practices" }),
             el("p", { class: "empty", text: "No practices scheduled yet." }));
      return;
    }

    const today = todayISO();
    // dates is newest-first; future needs oldest-first (soonest next), so reverse
    const future = dates.filter((x) => x.session.date >= today).slice().reverse();
    const past = dates.filter((x) => x.session.date < today);

    render(
      el("h2", { text: "Practices" }),
      practiceGroup("Upcoming", future, true),
      practiceGroup("Past", past, false)
    );
  }

  function viewWeek(w, sessionIdx) {
    setTitle(w.theme);

    if (!(sessionIdx >= 0) || sessionIdx >= w.sessions.length) sessionIdx = 0;
    const session = w.sessions[sessionIdx];

    const header = el("div", {},
      el("p", { class: "eyebrow", text: session.date ? formatDate(session.date) : weekLabel(w) }),
      el("h2", { text: w.theme || "This week" }),
      w.goal ? el("p", { class: "meta", text: w.goal }) : null
    );

    const items = el("ol", { class: "drills" },
      session.items.map((item, i) => {
        const d = drill(item.drillId);
        return el("li", {},
          el("a", { class: "drill-link",
                    // carry the plan context so the drill view can show which
                    // week/day it came from and offer prev/next within it
                    href: `#/drill/${enc(item.drillId)}/${enc(w.id)}/${sessionIdx}` },
            el("span", { class: "step", text: String(i + 1) }),
            el("span", { class: "body" },
              el("span", { class: "name" },
                d ? d.title : item.asWritten,
                d && !d.diagram ? el("span", { class: "badge", text: "no diagram" }) : null),
              item.note ? el("span", { class: "note", text: item.note }) : null),
            el("span", { class: "chev", text: "›" }))
        );
      }));

    const unmatched = (w.unmatchedReferences || []).length
      ? el("div", { class: "card" },
          el("h3", { text: "Mentioned but not found" }),
          list("ul", "points prose", w.unmatchedReferences))
      : null;

    render(header, items, unmatched);
  }

  /** ctx: {w, session, sessionIdx, pos} when opened from a plan, else null. */
  function viewDrill(id, ctx) {
    const d = drill(id);
    if (!d) return viewMissing(`No drill with id "${id}".`);

    setTitle(d.title);

    // where in the plan this drill sits; the neighbours go in the sticky footer
    let crumb = null;
    if (ctx) {
      const { w, session, sessionIdx, pos } = ctx;
      crumb = el("p", { class: "eyebrow crumb" },
        el("a", { href: `#/week/${enc(w.id)}/${sessionIdx}`,
                  text: session.date ? formatDate(session.date) : `${weekLabel(w)} · ${session.label}` }),
        el("span", { class: "pos", text: `${pos + 1} of ${session.items.length}` }));
    }
    setPager(ctx);

    // this practice's note on the drill, e.g. "Focus on three moves: ...".
    // Only meaningful in the context of a specific session -- the drill
    // library view has no ctx, so it never shows here.
    const sessionNote = ctx && ctx.session.items[ctx.pos].note
      ? el("p", { class: "session-note", text: ctx.session.items[ctx.pos].note })
      : null;

    const diagram = d.diagram
      ? el("img", {
          class: "diagram", src: d.diagram.path, alt: `Diagram: ${d.title}`,
          loading: "lazy", decoding: "async",
          width: d.diagram.width, height: d.diagram.height,
          onclick: () => openLightbox(d.diagram.path, d.title),
        })
      : el("p", { class: "no-diagram",
                  text: "No diagram — this drill was described in the email body." });

    const where = usedIn(d.id);
    const usage = where.length
      ? el("p", { class: "usedin" }, "Scheduled in ",
          where.map(({ week: w, session: s, sessionIdx: si }, i) => [
            i ? ", " : "",
            el("a", { href: `#/week/${enc(w.id)}/${si}`,
                      text: s.date ? formatDate(s.date) : `${weekLabel(w)} · ${s.label}` }),
          ]))
      : null;

    const tags = (d.derived && d.derived.tags || []).length
      ? el("div", { class: "tags" },
          d.derived.tags.map((t) => el("span", { class: "tag", text: t })))
      : null;

    // crumb + title stay pinned under the header while the drill body scrolls
    const head = el("div", { class: "drill-head" },
      crumb,
      el("h2", { text: d.title }));

    render(
      head,
      diagram,
      sessionNote,
      el("h3", { text: "Setup" }),
      el("p", { class: "prose" }, linkifyUrls(d.setup)),
      el("h3", { text: "Instructions" }),
      list("ol", "steps prose", d.instructions),
      el("h3", { text: "Coaching points" }),
      list("ul", "points prose", d.coachingPoints),
      tags,
      usage
    );
  }

  function viewLibrary(query) {
    setTitle("Drills");

    const all = Object.values(DATA.drills)
      .sort((a, b) => a.title.localeCompare(b.title));

    const q = (query || "").trim().toLowerCase();
    const hits = q
      ? all.filter((d) =>
          (d.title + " " + (d.derived && d.derived.tags || []).join(" ") + " " +
           d.coachingPoints.join(" ")).toLowerCase().includes(q))
      : all;

    const search = el("input", {
      class: "search", type: "search", value: query || "",
      placeholder: `Search ${all.length} drills…`,
      "aria-label": "Search drills",
    });
    // re-render on input without touching the hash (keeps focus + caret)
    search.addEventListener("input", () => {
      const pos = search.selectionStart;
      viewLibrary(search.value);
      const next = app.querySelector(".search");
      if (next) { next.focus(); next.setSelectionRange(pos, pos); }
    });

    const rows = hits.length
      ? el("ol", { class: "drills" }, hits.map((d) =>
          el("li", {},
            el("a", { class: "drill-link", href: `#/drill/${d.id}` },
              el("span", { class: "body" },
                el("span", { class: "name" }, d.title,
                  d.source.type === "email"
                    ? el("span", { class: "badge", text: "from email" }) : null),
                el("span", { class: "note",
                             text: (d.derived && d.derived.tags || []).join(" · ") })),
              el("span", { class: "chev", text: "›" })))))
      : el("p", { class: "empty", text: `Nothing matches “${query}”.` });

    render(el("h2", { text: "Drill library" }), search, rows);
  }

  function viewNotes(w) {
    setTitle("Notes");

    const blocks = [];

    if ((w.logistics || []).length) {
      blocks.push(el("div", { class: "card" },
        el("h3", { text: "Setup & logistics" }),
        list("ul", "points prose", w.logistics)));
    }

    for (const note of w.coachingNotes || []) {
      blocks.push(el("div", { class: "card" },
        el("h3", {}, note.title,
          note.scope === "evergreen"
            ? el("span", { class: "badge", text: "every week" }) : null),
        list("ul", "points prose", note.points)));
    }

    if (w.seasonFocus) {
      blocks.push(el("div", { class: "card" },
        el("h3", { text: "Season focus" }),
        el("p", { class: "prose", text: w.seasonFocus })));
    }

    render(
      el("p", { class: "eyebrow", text: weekLabel(w) }),
      el("h2", { text: "Notes" }),
      blocks.length ? blocks : el("p", { class: "empty", text: "No notes for this week." })
    );
  }

  /** Fill the sticky footer with prev/next, or hide it. The footer lives outside
   *  #app so it doesn't scroll, so every view must call this -- passing null. */
  function setPager(ctx) {
    if (!ctx) {
      pagerEl.hidden = true;
      pagerEl.replaceChildren();
      document.body.classList.remove("has-pager");
      return;
    }
    const { w, session, sessionIdx, pos } = ctx;
    const step = (delta) => {
      const n = session.items[pos + delta];
      const side = delta < 0 ? "prev" : "next";
      // no neighbour: an inert panel, so the live one keeps its half of the bar
      if (!n) return el("span", { class: `pager-slot pager-${side}`, "aria-hidden": "true" });
      const nd = drill(n.drillId);
      return el("a", {
        class: `pager-slot pager-${side}`,
        href: `#/drill/${enc(n.drillId)}/${enc(w.id)}/${sessionIdx}`,
        rel: delta < 0 ? "prev" : "next",
      },
        el("span", { class: "pager-dir", text: delta < 0 ? "‹ Previous" : "Next ›" }),
        el("span", { class: "pager-name", text: nd ? nd.title : n.asWritten }));
    };
    pagerEl.replaceChildren(el("div", { class: "pager-inner" }, step(-1), step(+1)));
    pagerEl.hidden = false;
    document.body.classList.add("has-pager");
  }

  function viewMissing(msg) {
    setTitle("Not found");
    render(el("p", { class: "empty", text: msg }),
           el("p", {}, el("a", { href: "#/", text: "Back to the plan" })));
  }

  // ---------- lightbox ----------

  function openLightbox(src, alt) {
    const img = lightbox.querySelector("img");
    img.src = src;
    img.alt = alt;
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeLightbox() {
    lightbox.hidden = true;
    lightbox.querySelector("img").removeAttribute("src");
    document.body.style.overflow = "";
  }
  lightbox.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
  });

  // ---------- routing ----------

  const enc = encodeURIComponent;

  let lastHash = null;   // guards the scroll reset against redundant route() calls

  /** Resolve "<weekId>/<sessionIdx>" + a drill id into a plan position. */
  function planContext(weekId, sessionIdx, drillId) {
    if (!weekId) return null;
    const w = DATA.weeks.find((x) => x.id === weekId);
    if (!w) return null;
    const i = Number(sessionIdx);
    const session = w.sessions[i];
    if (!session) return null;
    const pos = session.items.findIndex((it) => it.drillId === drillId);
    if (pos < 0) return null; // stale link: drill no longer in that session
    return { w, session, sessionIdx: i, pos };
  }

  function route() {
    if (!lightbox.hidden) closeLightbox();
    menuEl.open = false;
    // default off; viewDrill turns it back on when it has plan context, so no
    // other view can leave a stale footer behind
    setPager(null);
    const hash = location.hash.replace(/^#\/?/, "");
    let parts = hash.split("/");
    // a hand-typed or truncated hash can hold invalid %-escapes; don't let
    // decodeURIComponent's URIError take down the whole app
    try { parts = parts.map(decodeURIComponent); } catch { /* use raw */ }
    const [view, arg, arg2, arg3] = parts;

    // New destination: start at the top. Without this, paging from one drill to
    // the next keeps your scroll offset and drops you into the middle of the
    // coaching points. Done before the render so there's no visible jump.
    if (hash !== lastHash) {
      lastHash = hash;
      window.scrollTo(0, 0);
    }

    for (const a of document.querySelectorAll(".menu-panel a")) {
      // a drill opened from a plan still belongs to Plan; only a drill reached
      // from the library (no week context) highlights Drills
      const tab = view === "drill" ? (arg2 ? "plan" : "library")
                : view === "notes" ? "notes"
                : view === "library" ? "library" : "plan";
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }

    if (view === "drill" && arg) return viewDrill(arg, planContext(arg2, arg3, arg));
    if (view === "library") return viewLibrary("");
    if (view === "notes") return viewNotes(week(arg));
    if (view === "week" && arg) return viewWeek(week(arg), Number(arg2));
    return viewHome();
  }

  window.addEventListener("hashchange", route);

  // The menu is a <details>, so opening/closing is native. It only needs closing
  // on the cases the browser won't handle: tapping elsewhere, Escape, and
  // re-selecting the section you're already on (no hashchange, so no route()).
  document.addEventListener("click", (e) => {
    if (menuEl.open && !menuEl.contains(e.target)) menuEl.open = false;
  });
  menuEl.addEventListener("click", (e) => {
    if (e.target.closest(".menu-panel a")) menuEl.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuEl.open) {
      menuEl.open = false;
      menuEl.querySelector("summary").focus();
    }
  });

  // ---------- swipe between drills in a session ----------
  // Enhancement only. Targets are read out of the footer links, so "is there a
  // neighbour this way" has exactly one answer and the gesture is live only when
  // the footer is (i.e. a drill opened from a plan).
  //
  // Nothing here calls preventDefault: the listeners are passive so vertical
  // scrolling, pinch-zoom and text selection behave exactly as they would
  // otherwise. A gesture is classified after the fact, at touchend.

  const SWIPE_MIN_PX = 90;      // horizontal travel required
  const SWIPE_RATIO = 1.5;      // must be this much more horizontal than vertical
  const SWIPE_MAX_MS = 800;     // slower than this is a scroll or a drag, not a swipe

  let swipe = null;

  function followPager(side) {
    const a = pagerEl.querySelector(`a.pager-${side}`);
    if (a) location.hash = a.getAttribute("href");
  }

  document.addEventListener("touchstart", (e) => {
    // lightbox open: it scrolls horizontally to pan a zoomed diagram, so a
    // horizontal drag there means panning, not navigation
    swipe = (pagerEl.hidden || !lightbox.hidden || e.touches.length !== 1)
      ? null
      : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (e.touches.length > 1) swipe = null;   // became a pinch
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    const s = swipe;
    swipe = null;
    if (!s || pagerEl.hidden) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Date.now() - s.t > SWIPE_MAX_MS) return;
    if (Math.abs(dx) < SWIPE_MIN_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;   // mostly vertical
    followPager(dx < 0 ? "next" : "prev");                   // swipe left = forward
  }, { passive: true });

  document.addEventListener("touchcancel", () => { swipe = null; }, { passive: true });

  // ---------- boot ----------

  fetch("data/site.json", { cache: "no-cache" })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((d) => {
      // Display-only: data keeps the verbatim PDF title; the director's byline
      // is just noise in a drill name on a phone.
      for (const dr of Object.values(d.drills)) {
        dr.title = dr.title.replace(/\s*[-\u2013\u2014]\s*Mauro Nobre\s*$/i, "");
      }
      DATA = d; route();
    })
    .catch((err) => {
      render(
        el("h2", { text: "Couldn’t load the plan" }),
        el("p", { class: "meta", text: String(err) }),
        el("p", { class: "meta", text:
          "If you opened this file directly, serve it over HTTP instead — " +
          "browsers block fetch() on file:// URLs. Try: python3 -m http.server" })
      );
    });
})();
