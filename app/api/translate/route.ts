import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Lang = "en" | "es";
const LANGS: ReadonlySet<string> = new Set(["en", "es"]);
const TIMEOUT_MS = 6000;

function decodeEntities(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Optional, best quality. Free DeepL keys end in ":fx" and use the free endpoint.
async function viaDeepL(text: string, from: Lang, to: Lang, key: string) {
  const host = key.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
  const res = await fetch(`https://${host}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [text],
      source_lang: from.toUpperCase(),
      target_lang: to === "en" ? "EN-US" : "ES",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`deepl ${res.status}`);
  const data = await res.json();
  const out = data?.translations?.[0]?.text;
  if (typeof out !== "string" || !out.trim()) throw new Error("deepl empty");
  return out.trim();
}

// Free, no key. Anonymous limit is about 5,000 characters a day; setting
// MYMEMORY_EMAIL raises it to about 50,000.
async function viaMyMemory(text: string, from: Lang, to: Lang) {
  if (new TextEncoder().encode(text).length > 480) throw new Error("mymemory too long");
  const params = new URLSearchParams({ q: text, langpair: `${from}|${to}` });
  const email = process.env.MYMEMORY_EMAIL;
  if (email) params.set("de", email);
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`mymemory ${res.status}`);
  const data = await res.json();
  const out = data?.responseData?.translatedText;
  if (
    Number(data?.responseStatus) !== 200 ||
    typeof out !== "string" ||
    !out.trim() ||
    /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE/i.test(out)
  ) {
    throw new Error("mymemory unusable");
  }
  const clean = decodeEntities(out.trim());
  // An unchanged echo of a full sentence usually means it found nothing.
  if (clean.toLowerCase() === text.toLowerCase() && text.split(/\s+/).length > 2) {
    throw new Error("mymemory echo");
  }
  return clean;
}

// Fallback when MyMemory is over its limit or down.
async function viaGoogle(text: string, from: Lang, to: Lang) {
  const params = new URLSearchParams({ client: "gtx", sl: from, tl: to, dt: "t", q: text });
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`google ${res.status}`);
  const data = await res.json();
  const parts: unknown = data?.[0];
  if (!Array.isArray(parts)) throw new Error("google shape");
  const out = parts
    .map((p) => (Array.isArray(p) && typeof p[0] === "string" ? p[0] : ""))
    .join("")
    .trim();
  if (!out) throw new Error("google empty");
  return out;
}

export async function POST(req: Request) {
  let body: { text?: unknown; from?: unknown; to?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const from = String(body.from ?? "");
  const to = String(body.to ?? "");

  if (!text || text.length > 1000) {
    return NextResponse.json({ error: "Text must be 1 to 1000 characters" }, { status: 400 });
  }
  if (!LANGS.has(from) || !LANGS.has(to) || from === to) {
    return NextResponse.json({ error: "from/to must be 'en' or 'es' and different" }, { status: 400 });
  }

  const providers: Array<[string, () => Promise<string>]> = [];
  const deeplKey = process.env.DEEPL_API_KEY;
  if (deeplKey) providers.push(["deepl", () => viaDeepL(text, from as Lang, to as Lang, deeplKey)]);
  providers.push(["mymemory", () => viaMyMemory(text, from as Lang, to as Lang)]);
  providers.push(["google", () => viaGoogle(text, from as Lang, to as Lang)]);

  const failures: string[] = [];
  for (const [name, run] of providers) {
    try {
      const translation = await run();
      return NextResponse.json({ translation, provider: name });
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  console.error("translate failed", failures);
  return NextResponse.json({ error: "Translation failed" }, { status: 502 });
}
