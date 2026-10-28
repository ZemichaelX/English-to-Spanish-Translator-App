"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal Web Speech API types (not in TypeScript's DOM lib yet). */
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  isFinal: boolean;
  length: number;
  [i: number]: SRAlternative;
}
interface SREvent {
  results: { length: number; [i: number]: SRResult };
}
interface SRErrorEvent {
  error: string;
}
interface SR {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SR;

function getSR(): SRCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

type Side = "her" | "him";
type Status = "translating" | "done" | "error";
type Turn = { id: number; from: Side; original: string; translated: string; status: Status };
type Live = { side: Side; text: string };
type Notice = { side: Side; text: string };

const other = (s: Side): Side => (s === "her" ? "him" : "her");

const LANG = {
  her: { speech: "es-MX", code: "es", voices: ["es-mx", "es-us", "es-419", "es-es"] },
  him: { speech: "en-US", code: "en", voices: ["en-us", "en-gb", "en-au"] },
} as const;

const COPY = {
  her: {
    language: "Español",
    hint: "Toca para hablar",
    listening: "Te escucho. Toca para terminar",
    empty: "Toca el micrófono y habla en español. Él lo escuchará en inglés.",
    otherSpeaking: "Él está hablando",
    translating: "Traduciendo",
    noSpeech: "No te escuché. Intenta otra vez.",
    micDenied: "Permite el micrófono en el navegador para poder escucharte.",
    network: "Sin conexión. Revisa el internet e intenta otra vez.",
    failed: "No se pudo traducir. Toca para reintentar.",
    unsupported: "Este navegador no puede escuchar. Abre el enlace en Chrome.",
    mic: "Hablar en español",
    stop: "Terminar",
  },
  him: {
    language: "English",
    hint: "Tap to speak",
    listening: "Listening. Tap to finish",
    empty: "Tap the mic and speak English. She'll hear it in Spanish.",
    otherSpeaking: "She's talking",
    translating: "Translating",
    noSpeech: "Didn't catch that. Try again.",
    micDenied: "Allow the microphone in your browser so it can hear you.",
    network: "No connection. Check your internet and try again.",
    failed: "Couldn't translate. Tap to retry.",
    unsupported: "This browser can't do speech recognition. Open the link in Chrome.",
    mic: "Speak English",
    stop: "Finish",
  },
} as const;

function pickVoice(voices: SpeechSynthesisVoice[], prefs: readonly string[]) {
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  for (const p of prefs) {
    const v = voices.find((x) => norm(x.lang) === p);
    if (v) return v;
  }
  const base = prefs[0].slice(0, 2);
  return voices.find((x) => norm(x.lang).startsWith(base)) ?? null;
}

/* Some Android builds repeat the whole transcript in every result. */
function readTranscript(e: SREvent) {
  const parts: { text: string; final: boolean }[] = [];
  for (let i = 0; i < e.results.length; i++) {
    parts.push({ text: e.results[i][0].transcript.trim(), final: e.results[i].isFinal });
  }
  const cumulative =
    parts.length > 1 &&
    parts.every((p, i) => i === 0 || p.text.toLowerCase().startsWith(parts[i - 1].text.toLowerCase()));
  if (cumulative) {
    const last = parts[parts.length - 1];
    return { final: last.final ? last.text : "", all: last.text };
  }
  const final = parts.filter((p) => p.final).map((p) => p.text).join(" ");
  const all = parts.map((p) => p.text).join(" ");
  return { final: final.trim(), all: all.replace(/\s+/g, " ").trim() };
}

type WakeLockNav = Navigator & { wakeLock?: { request(type: "screen"): Promise<unknown> } };

export default function Translator() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [faceToFace, setFaceToFace] = useState(true);

  const recRef = useRef<SR | null>(null);
  const liveRef = useRef<Live | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const primedRef = useRef(false);
  const idRef = useRef(0);

  useEffect(() => {
    setSupported(!!getSR() && "speechSynthesis" in window);
    try {
      if (localStorage.getItem("habla:faceToFace") === "0") setFaceToFace(false);
    } catch {}
    if (!("speechSynthesis" in window)) return;
    const load = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Keep the screen awake once the conversation has started.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && primedRef.current) {
        (navigator as WakeLockNav).wakeLock?.request("screen").catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const setLiveState = (l: Live | null) => {
    liveRef.current = l;
    setLive(l);
  };

  const speak = useCallback((text: string, listener: Side) => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG[listener].speech;
    const voices = voicesRef.current.length ? voicesRef.current : synth.getVoices();
    const v = pickVoice(voices, LANG[listener].voices);
    if (v) u.voice = v;
    u.rate = 0.97;
    synth.speak(u);
  }, []);

  const translate = useCallback(
    async (turn: Turn) => {
      const listener = other(turn.from);
      setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, status: "translating" } : t)));
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: turn.original, from: LANG[turn.from].code, to: LANG[listener].code }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || typeof data?.translation !== "string") throw new Error("translate failed");
        setTurns((ts) =>
          ts.map((t) => (t.id === turn.id ? { ...t, translated: data.translation, status: "done" } : t)),
        );
        // Don't talk over someone who already started recording.
        if (!recRef.current) speak(data.translation, listener);
      } catch {
        setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, status: "error" } : t)));
      }
    },
    [speak],
  );

  const prime = () => {
    if (primedRef.current) return;
    primedRef.current = true;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {}
    (navigator as WakeLockNav).wakeLock?.request("screen").catch(() => {});
  };

  const toggleMic = (side: Side) => {
    const Recognition = getSR();
    if (!Recognition) return;
    prime();
    setNotice(null);

    const current = recRef.current;
    if (current) {
      if (liveRef.current?.side === side) {
        current.stop();
        return;
      }
      recRef.current = null;
      current.abort();
    }
    window.speechSynthesis?.cancel();

    const rec = new Recognition();
    rec.lang = LANG[side].speech;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = "";
    let latest = "";
    let errored = false;

    rec.onresult = (e) => {
      const t = readTranscript(e);
      finalText = t.final;
      latest = t.all;
      if (recRef.current === rec) setLiveState({ side, text: latest });
    };

    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      errored = true;
      if (recRef.current !== rec) return;
      const c = COPY[side];
      const text =
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? c.micDenied
          : e.error === "network"
            ? c.network
            : c.noSpeech;
      setNotice({ side, text });
    };

    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      setLiveState(null);
      const text = (finalText || latest).trim();
      if (!text) {
        if (!errored) setNotice({ side, text: COPY[side].noSpeech });
        return;
      }
      const turn: Turn = { id: ++idRef.current, from: side, original: text, translated: "", status: "translating" };
      setTurns((ts) => [...ts, turn]);
      void translate(turn);
    };

    recRef.current = rec;
    setLiveState({ side, text: "" });
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setLiveState(null);
      setNotice({ side, text: COPY[side].noSpeech });
    }
  };

  const onTurn = (turn: Turn, reader: Side) => {
    if (turn.status === "error") {
      void translate(turn);
      return;
    }
    if (turn.status !== "done") return;
    // Tapping a translation replays it for the reader; tapping your own line repeats it for the other person.
    speak(turn.translated, turn.from === reader ? other(reader) : reader);
  };

  const clear = () => {
    const rec = recRef.current;
    recRef.current = null;
    rec?.abort();
    setLiveState(null);
    window.speechSynthesis?.cancel();
    setTurns([]);
    setNotice(null);
  };

  const toggleFaceToFace = () => {
    setFaceToFace((v) => {
      try {
        localStorage.setItem("habla:faceToFace", v ? "0" : "1");
      } catch {}
      return !v;
    });
  };

  const shared = { turns, live, notice, supported, onMic: toggleMic, onTurn };

  return (
    <main className="app">
      <Half side="her" flipped={faceToFace} {...shared} />
      <div className="bar">
        <button type="button" className="barBtn" onClick={toggleFaceToFace} aria-pressed={faceToFace}>
          <span className={`switch${faceToFace ? " on" : ""}`} aria-hidden="true" />
          Face to face
        </button>
        <button type="button" className="barBtn" onClick={clear} disabled={!turns.length && !live}>
          Clear
        </button>
      </div>
      <Half side="him" flipped={false} {...shared} />
    </main>
  );
}

function Half({
  side,
  flipped,
  turns,
  live,
  notice,
  supported,
  onMic,
  onTurn,
}: {
  side: Side;
  flipped: boolean;
  turns: Turn[];
  live: Live | null;
  notice: Notice | null;
  supported: boolean | null;
  onMic: (side: Side) => void;
  onTurn: (turn: Turn, reader: Side) => void;
}) {
  const c = COPY[side];
  const feedRef = useRef<HTMLDivElement>(null);
  const listening = live?.side === side;
  const otherSpeaking = !!live && live.side !== side;
  const lastIncomingId = [...turns].reverse().find((t) => t.from !== side)?.id;

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, live, notice]);

  return (
    <section className={`half ${side}${flipped ? " flipped" : ""}`} lang={LANG[side].code} aria-label={c.language}>
      <header className="halfHead">{c.language}</header>

      <div className="feed" ref={feedRef} aria-live="polite">
        {supported === false ? (
          <p className="empty">{c.unsupported}</p>
        ) : turns.length === 0 && !live ? (
          <p className="empty">{c.empty}</p>
        ) : null}

        {turns.map((t) => {
          if (t.from === side) {
            return (
              <button
                key={t.id}
                type="button"
                className={`own${t.status === "translating" ? " pending" : ""}`}
                onClick={() => onTurn(t, side)}
              >
                {t.original}
                {t.status === "error" && <span className="ownErr">{c.failed}</span>}
              </button>
            );
          }
          if (t.status === "translating") {
            return (
              <div key={t.id} className="incoming skeleton" role="status" aria-label={c.translating}>
                <span className="sk" style={{ width: "82%" }} />
                <span className="sk" style={{ width: "54%" }} />
              </div>
            );
          }
          if (t.status === "error") {
            return (
              <button key={t.id} type="button" className="incoming failed" onClick={() => onTurn(t, side)}>
                {c.failed}
              </button>
            );
          }
          return (
            <button
              key={t.id}
              type="button"
              className={`incoming${t.id === lastIncomingId ? " latest" : ""}`}
              onClick={() => onTurn(t, side)}
            >
              {t.translated}
            </button>
          );
        })}

        {listening && live.text && <div className="own live">{live.text}</div>}
        {otherSpeaking && (
          <div className="speaking">
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {c.otherSpeaking}
          </div>
        )}
      </div>

      {notice?.side === side && (
        <p className="notice" role="status">
          {notice.text}
        </p>
      )}

      <div className="micRow">
        <span className="micLabel">{listening ? c.listening : c.hint}</span>
        <button
          type="button"
          className={`mic${listening ? " on" : ""}`}
          onClick={() => onMic(side)}
          disabled={supported === false}
          aria-label={listening ? c.stop : c.mic}
          aria-pressed={listening}
        >
          {listening ? (
            <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" />
            </svg>
          ) : (
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="2.5" width="6" height="12" rx="3" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
              <path d="M12 17.5V21.5" />
            </svg>
          )}
        </button>
      </div>
    </section>
  );
}
