"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * An original soft four-note chime for incoming IT support calls. A browser cannot reliably autoplay
 * sound before its first user gesture; pre-unlock on IT navigation clicks and
 * expose a direct "enable sound" button on an incoming call as a fallback.
 */
export function useSupportIncomingRingtone(incoming: boolean) {
  const audioRef = useRef<AudioContext | null>(null);
  const [ready, setReady] = useState(false);

  const enable = useCallback(async () => {
    if (typeof window === "undefined") return;
    const AudioContextCtor = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
      let context = audioRef.current;
      if (!context || context.state === "closed") {
        context = new AudioContextCtor();
        audioRef.current = context;
      }
      if (context.state === "suspended") await context.resume();
      setReady(context.state === "running");
    } catch {
      setReady(false);
    }
  }, []);

  const pulse = useCallback(() => {
    const context = audioRef.current;
    if (!context || context.state !== "running") return;
    try {
      const now = context.currentTime;
      // Original short C-major bell motif, not a continuous telephone drone.
      // Each note decays gently with a soft harmonic so it remains audible on
      // small Windows/mobile speakers without becoming harsh or fatiguing.
      const notes = [
        { frequency: 523.25, offset: 0, duration: 0.22 },
        { frequency: 659.25, offset: 0.23, duration: 0.24 },
        { frequency: 783.99, offset: 0.48, duration: 0.38 },
        { frequency: 659.25, offset: 0.91, duration: 0.26 }
      ];
      for (const note of notes) {
        const start = now + note.offset;
        const end = start + note.duration;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.10, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        gain.connect(context.destination);
        for (const [multiplier, volume] of [[1, 1], [2, 0.11]] as const) {
          const oscillator = context.createOscillator();
          const overtone = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(note.frequency * multiplier, start);
          overtone.gain.value = volume;
          oscillator.connect(overtone);
          overtone.connect(gain);
          oscillator.start(start);
          oscillator.stop(end + 0.02);
          oscillator.onended = () => {
            oscillator.disconnect();
            overtone.disconnect();
          };
        }
        window.setTimeout(() => gain.disconnect(), (note.offset + note.duration + 0.15) * 1000);
      }
    } catch {
      // Keep the visual incoming-call controls usable without Web Audio.
    }
  }, []);

  useEffect(() => {
    const unlock = () => { void enable(); };
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    const foreground = () => {
      if (document.visibilityState === "visible" && audioRef.current) void enable();
    };
    document.addEventListener("visibilitychange", foreground);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      document.removeEventListener("visibilitychange", foreground);
      if (audioRef.current) void audioRef.current.close().catch(() => null);
      audioRef.current = null;
    };
  }, [enable]);

  useEffect(() => {
    if (incoming) void enable();
  }, [incoming, enable]);

  useEffect(() => {
    if (!incoming || !ready) return;
    pulse();
    const timer = window.setInterval(pulse, 4_200);
    return () => window.clearInterval(timer);
  }, [incoming, ready, pulse]);

  const activateRing = useCallback(async () => {
    await enable();
    pulse();
  }, [enable, pulse]);

  return { ringReady: ready, activateRing };
}
