"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * An original two-tone ringing signal. A browser cannot reliably autoplay
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
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(440, now);
      oscillator.frequency.setValueAtTime(554.37, now + 0.33);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
      gain.gain.setValueAtTime(0.18, now + 0.62);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.73);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.75);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
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
    const timer = window.setInterval(pulse, 1_700);
    return () => window.clearInterval(timer);
  }, [incoming, ready, pulse]);

  const activateRing = useCallback(async () => {
    await enable();
    pulse();
  }, [enable, pulse]);

  return { ringReady: ready, activateRing };
}
