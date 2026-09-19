/* ══════════════════════════════════════════════════════════════
   .ics（カレンダー用ファイル）を返す Vercel の関数

   ブラウザ側で組み立てて blob でダウンロードさせる方法だと、
   LINEのアプリ内ブラウザでは保存が始まりません（download属性と
   blob: が効かないため）。ここで本物のファイルとして返すことで、
   LINE内からでもカレンダーに取り込めるようにしています。

   呼び出し例: /api/ics?start=2026-09-20T14:00&dur=45

   ▼ 予定の中身は script.js の CONFIG と揃えてください
   ══════════════════════════════════════════════════════════════ */

const EVENT = {
  TITLE: "KNCT UNIVERSITY 面談",
  DETAILS:
    "静かな場所から、カメラONで繋いでください。今どこにいて、どこへ行きたいのかを話せる状態で来てください。",
  LOCATION: "オンライン",
  DEFAULT_DURATION_MIN: 45,
};

const START_KEYS = ["start", "datetime", "date", "d", "t", "start_time", "event_start_time"];
const END_KEYS = ["end", "end_time", "event_end_time"];
const DURATION_KEYS = ["dur", "duration", "minutes"];

function firstParam(query, keys) {
  for (const key of keys) {
    const raw = query[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value && String(value).trim()) return String(value).trim();
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  if (/^\d{10}$/.test(value)) return valid(new Date(Number(value) * 1000));
  if (/^\d{13}$/.test(value)) return valid(new Date(Number(value)));

  let text = value.replace(/\//g, "-").replace(/\s+/, "T");
  // 日付だけなら 00:00 を補う
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += "T00:00";
  // タイムゾーンの指定が無ければ日本時間とみなす
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += "+09:00";
  return valid(new Date(text));
}

function valid(date) {
  return date instanceof Date && !isNaN(date.getTime()) ? date : null;
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// RFC 5545 の TEXT 値のエスケープ。順序を守ること（先にバックスラッシュ）
function escapeText(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

// RFC 5545 の行折り返し。1行75オクテットまで、continuation は先頭に空白1つ。
// 和文はUTF-8で1文字3バイトなので、文字単位ではなくバイト数で数える。
function fold(line) {
  const out = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    const limit = out.length === 0 ? 75 : 74; // continuation 行は先頭の空白分を引く
    if (bytes + size > limit) {
      out.push(current);
      current = ch;
      bytes = size;
    } else {
      current += ch;
      bytes += size;
    }
  }
  out.push(current);
  return out[0] + out.slice(1).map((s) => "\r\n " + s).join("");
}

function buildIcs(start, end) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KNCT UNIVERSITY//Call Confirmed//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + stamp(start) + "-knct@joinknct.com",
    "DTSTAMP:" + stamp(new Date()),
    "DTSTART:" + stamp(start),
    "DTEND:" + stamp(end),
    "SUMMARY:" + escapeText(EVENT.TITLE),
    "DESCRIPTION:" + escapeText(EVENT.DETAILS),
    "LOCATION:" + escapeText(EVENT.LOCATION),
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:" + escapeText(EVENT.TITLE),
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

module.exports = (req, res) => {
  const query = (req.query && Object.keys(req.query).length)
    ? req.query
    : Object.fromEntries(new URL(req.url, "http://localhost").searchParams);

  const start = parseDate(firstParam(query, START_KEYS));
  if (!start) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("面談の日時が指定されていません。例: /api/ics?start=2026-09-20T14:00");
    return;
  }

  let end = parseDate(firstParam(query, END_KEYS));
  if (!end || end <= start) {
    const raw = firstParam(query, DURATION_KEYS);
    const minutes = raw && Number(raw) > 0 ? Number(raw) : EVENT.DEFAULT_DURATION_MIN;
    end = new Date(start.getTime() + minutes * 60000);
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="knct-meeting.ics"');
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.end(buildIcs(start, end));
};
