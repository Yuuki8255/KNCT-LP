/* ══════════════════════════════════════════════════════════════
   KNCT UNIVERSITY — 面談予約完了ページ

   ▼ 触るのはこの CONFIG だけで OK です
   ══════════════════════════════════════════════════════════════ */

const CONFIG = {
  // 動画の URL をここに入れると、プレースホルダーが動画に差し替わります。
  // YouTube / Vimeo / .mp4 の直リンク に対応しています。
  //   例) "https://www.youtube.com/watch?v=xxxxxxxxxxx"
  //   例) "https://youtu.be/xxxxxxxxxxx"
  //   例) "https://vimeo.com/123456789"
  VIDEO_URL: "",

  // カレンダーに登録される予定のタイトル・説明・場所
  EVENT_TITLE: "KNCT UNIVERSITY 面談",
  EVENT_DETAILS: "静かな場所から、カメラONで繋いでください。今どこにいて、どこへ行きたいのかを話せる状態で来てください。",
  EVENT_LOCATION: "オンライン",

  // URL で時間（?end= または ?dur=）が渡されなかった場合の所要時間（分）
  DEFAULT_DURATION_MIN: 45,
};

/* ══════════════════════════════════════════════════════════════
   ここから下は触らなくて大丈夫です
   ══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  /* ── 動画の差し替え ──────────────────────────────────── */

  function buildVideoEmbed(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch (_) {
      return null;
    }

    const host = url.hostname.replace(/^www\./, "");

    // YouTube
    let youtubeId = null;
    if (host === "youtu.be") {
      youtubeId = url.pathname.slice(1);
    } else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (url.pathname === "/watch") youtubeId = url.searchParams.get("v");
      else if (url.pathname.startsWith("/embed/")) youtubeId = url.pathname.split("/")[2];
      else if (url.pathname.startsWith("/shorts/")) youtubeId = url.pathname.split("/")[2];
      else if (url.pathname.startsWith("/live/")) youtubeId = url.pathname.split("/")[2];
    }
    if (youtubeId) {
      return iframe(
        "https://www.youtube-nocookie.com/embed/" +
          encodeURIComponent(youtubeId) +
          "?rel=0&modestbranding=1&playsinline=1"
      );
    }

    // Vimeo
    if (host.endsWith("vimeo.com")) {
      const vimeoId = url.pathname.split("/").filter(Boolean)[0];
      if (vimeoId && /^\d+$/.test(vimeoId)) {
        return iframe("https://player.vimeo.com/video/" + vimeoId + "?title=0&byline=0&portrait=0");
      }
    }

    // 動画ファイルの直リンク
    if (/\.(mp4|webm|ogg|mov)$/i.test(url.pathname)) {
      const video = document.createElement("video");
      video.src = url.href;
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      return video;
    }

    // それ以外は、そのまま iframe として埋め込んでみる
    return iframe(url.href);
  }

  function iframe(src) {
    const el = document.createElement("iframe");
    el.src = src;
    el.title = "KNCT UNIVERSITY 面談前の動画";
    el.loading = "lazy";
    el.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";
    el.allowFullscreen = true;
    return el;
  }

  function mountVideo() {
    const frame = document.getElementById("video-frame");
    if (!frame || !CONFIG.VIDEO_URL) return;
    const embed = buildVideoEmbed(CONFIG.VIDEO_URL.trim());
    if (!embed) return;
    frame.textContent = "";
    frame.appendChild(embed);
  }

  /* ── カレンダー ──────────────────────────────────────
     URL に面談日時が渡された時だけセクションを表示します。
     例) .../index.html?start=2026-09-20T14:00&name=山田
     日時にタイムゾーンが無い場合は日本時間として扱います。
     ─────────────────────────────────────────────────── */

  const START_KEYS = ["start", "datetime", "date", "d", "t", "start_time", "event_start_time"];
  const END_KEYS = ["end", "end_time", "event_end_time"];
  const DURATION_KEYS = ["dur", "duration", "minutes"];
  const NAME_KEYS = ["name", "invitee", "invitee_name", "n"];

  function firstParam(params, keys) {
    for (const key of keys) {
      const value = params.get(key);
      if (value) return value.trim();
    }
    return null;
  }

  function parseDate(value) {
    if (!value) return null;

    // UNIX 秒 / ミリ秒
    if (/^\d{10}$/.test(value)) return validDate(new Date(Number(value) * 1000));
    if (/^\d{13}$/.test(value)) return validDate(new Date(Number(value)));

    let text = value.replace(/\s+/, "T");
    // タイムゾーンの指定が無ければ日本時間とみなす
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += "+09:00";
    return validDate(new Date(text));
  }

  function validDate(date) {
    return date instanceof Date && !isNaN(date.getTime()) ? date : null;
  }

  function formatJst(date) {
    const datePart = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(date);
    const timePart = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
    return datePart + " " + timePart;
  }

  function toUtcStamp(date) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  function escapeIcs(text) {
    return String(text)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  function buildIcs(start, end) {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//KNCT UNIVERSITY//Call Confirmed//JA",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + toUtcStamp(start) + "-knct@joinknct.com",
      "DTSTAMP:" + toUtcStamp(new Date()),
      "DTSTART:" + toUtcStamp(start),
      "DTEND:" + toUtcStamp(end),
      "SUMMARY:" + escapeIcs(CONFIG.EVENT_TITLE),
      "DESCRIPTION:" + escapeIcs(CONFIG.EVENT_DETAILS),
      "LOCATION:" + escapeIcs(CONFIG.EVENT_LOCATION),
      "BEGIN:VALARM",
      "TRIGGER:-PT30M",
      "ACTION:DISPLAY",
      "DESCRIPTION:" + escapeIcs(CONFIG.EVENT_TITLE),
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    // ICS は CRLF 改行
    return lines.join("\r\n") + "\r\n";
  }

  function icsHref(text) {
    try {
      const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
      return URL.createObjectURL(blob);
    } catch (_) {
      return "data:text/calendar;charset=utf-8," + encodeURIComponent(text);
    }
  }

  function mountCalendar() {
    const section = document.getElementById("calendar-section");
    if (!section) return;

    const params = new URLSearchParams(location.search);
    const start = parseDate(firstParam(params, START_KEYS));
    if (!start) return; // 日時が渡されていなければ、セクションごと出さない

    let end = parseDate(firstParam(params, END_KEYS));
    if (!end || end <= start) {
      const raw = firstParam(params, DURATION_KEYS);
      const minutes = raw && Number(raw) > 0 ? Number(raw) : CONFIG.DEFAULT_DURATION_MIN;
      end = new Date(start.getTime() + minutes * 60000);
    }

    const name = firstParam(params, NAME_KEYS);
    const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);

    document.getElementById("cal-date").textContent = formatJst(start);
    document.getElementById("cal-meta").textContent =
      (name ? name + " 様 ／ " : "") + "所要時間 約" + durationMin + "分（日本時間）";

    const googleUrl =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=" + encodeURIComponent(CONFIG.EVENT_TITLE) +
      "&dates=" + toUtcStamp(start) + "/" + toUtcStamp(end) +
      "&details=" + encodeURIComponent(CONFIG.EVENT_DETAILS) +
      "&location=" + encodeURIComponent(CONFIG.EVENT_LOCATION);

    const outlookUrl =
      "https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent" +
      "&subject=" + encodeURIComponent(CONFIG.EVENT_TITLE) +
      "&startdt=" + encodeURIComponent(start.toISOString()) +
      "&enddt=" + encodeURIComponent(end.toISOString()) +
      "&body=" + encodeURIComponent(CONFIG.EVENT_DETAILS) +
      "&location=" + encodeURIComponent(CONFIG.EVENT_LOCATION);

    document.getElementById("cal-google").href = googleUrl;
    document.getElementById("cal-outlook").href = outlookUrl;
    document.getElementById("cal-apple").href = icsHref(buildIcs(start, end));

    section.hidden = false;
  }

  /* ── スクロールで表示 ────────────────────────────────── */

  function mountReveal() {
    const targets = document.querySelectorAll("[data-reveal]");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || !("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("is-in"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
    );

    targets.forEach((el, i) => {
      el.style.transitionDelay = Math.min(i % 6, 4) * 55 + "ms";
      observer.observe(el);
    });
  }

  mountVideo();
  mountCalendar();
  mountReveal();
})();
