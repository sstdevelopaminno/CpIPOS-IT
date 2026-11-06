"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceQueueSnapshot = {
  position: number;
  ahead_count: number;
  waiting_count: number;
  active_calls: number;
  queued_since: string | null;
  lease_seconds: number;
};

type WaitingAudio = {
  context: AudioContext;
  source: AudioBufferSourceNode;
  gain: GainNode;
};

export function useSupportVoiceWaitingMedia() {
  const [queue, setQueueState] = useState<VoiceQueueSnapshot | null>(null);
  const queueRef = useRef<VoiceQueueSnapshot | null>(null);
  const audioRef = useRef<WaitingAudio | null>(null);
  const announcementTimerRef = useRef<number | null>(null);
  const activeSpeechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [speechIssue, setSpeechIssue] = useState(false);

  const setQueue = useCallback((next: VoiceQueueSnapshot | null) => {
    queueRef.current = next;
    setQueueState(next);
  }, []);

  const stop = useCallback(() => {
    if (announcementTimerRef.current) window.clearInterval(announcementTimerRef.current);
    announcementTimerRef.current = null;

    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      try { audio.source.stop(); } catch {}
      void audio.context.close().catch(() => null);
    }

    activeSpeechRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const startMusic = useCallback(async () => {
    if (audioRef.current || typeof window === "undefined") return;
    const AudioContextCtor = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    try {
      const context = new AudioContextCtor();
      const seconds = 12;
      const frameCount = Math.floor(context.sampleRate * seconds);
      const buffer = context.createBuffer(1, frameCount, context.sampleRate);
      const data = buffer.getChannelData(0);
      const notes = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23, 261.63, 329.63, 392, 523.25];
      const noteFrames = Math.floor(context.sampleRate);

      for (let i = 0; i < frameCount; i += 1) {
        const noteIndex = Math.min(notes.length - 1, Math.floor(i / noteFrames));
        const phaseInNote = (i % noteFrames) / noteFrames;
        const fadeIn = Math.min(1, phaseInNote * 5);
        const fadeOut = Math.min(1, (1 - phaseInNote) * 5);
        const envelope = Math.min(1, fadeIn, fadeOut); // Sustain audible amplitude throughout each note
        data[i] = Math.sin(2 * Math.PI * notes[noteIndex] * (i / context.sampleRate)) * envelope * 0.11;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = context.createGain();
      gain.gain.value = 0.85;
      source.connect(gain);
      gain.connect(context.destination);
      audioRef.current = { context, source, gain };
      source.start();
      if (context.state === "suspended") await context.resume().catch(() => null);
    } catch {
      const playing = audioRef.current;
      audioRef.current = null;
      if (playing) {
        try { playing.source.stop(); } catch {}
        void playing.context.close().catch(() => null);
      }
      // A Web Audio failure must never cancel an in-progress Thai greeting.
    }
  }, []);

  const announce = useCallback((snapshot: VoiceQueueSnapshot | null = queueRef.current) => {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      setSpeechIssue(true);
      return;
    }

    const message = snapshot?.position
      ? snapshot.position > 1
        ? `ขณะนี้เจ้าหน้าที่กำลังให้บริการลูกค้าท่านอื่น กรุณารอสักครู่ คุณอยู่ในคิวลำดับที่ ${snapshot.position}`
        : "ขณะนี้คุณอยู่คิวแรก กรุณารอสักครู่ เจ้าหน้าที่จะรับสายของคุณโดยเร็วที่สุด"
      : "ยินดีต้อนรับสู่ CpiPOS Support ขณะนี้กำลังติดต่อเจ้าหน้าที่ กรุณารอสักครู่";

    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      // Keep the utterance reachable: Android WebViews may cut off speech
      // when the browser garbage-collects an unreferenced utterance.
      activeSpeechRef.current = utterance;
      utterance.lang = "th-TH";
      const thaiVoice = synth.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("th"));
      if (thaiVoice) utterance.voice = thaiVoice;
      utterance.rate = 0.92;
      utterance.pitch = 1;
      utterance.volume = 1;
      // Duck the local waiting melody while Thai TTS speaks so callers can
      // understand the announcement even with small Android speakers.
      utterance.onstart = () => {
        setSpeechIssue(false);
        const playing = audioRef.current;
        if (playing) playing.gain.gain.setTargetAtTime(0.08, playing.context.currentTime, 0.05);
      };
      const restoreMusic = () => {
        const playing = audioRef.current;
        if (playing) playing.gain.gain.setTargetAtTime(0.85, playing.context.currentTime, 0.15);
      };
      utterance.onend = () => {
        restoreMusic();
        if (activeSpeechRef.current === utterance) activeSpeechRef.current = null;
      };
      utterance.onerror = () => {
        setSpeechIssue(true);
        restoreMusic();
        if (activeSpeechRef.current === utterance) activeSpeechRef.current = null;
      };
      synth.speak(utterance);
      if (synth.paused) synth.resume();
    } catch {
      setSpeechIssue(true);
    }
  }, []);

  const start = useCallback((initialQueue?: VoiceQueueSnapshot | null) => {
    if (initialQueue !== undefined) {
      setQueue(initialQueue);
    }
    // Call this synchronously inside the customer's call button gesture.
    if (!announcementTimerRef.current || initialQueue !== undefined) {
      announce(initialQueue === undefined ? queueRef.current : initialQueue);
    }
    void startMusic();

    if (!announcementTimerRef.current) {
      announcementTimerRef.current = window.setInterval(() => {
        if (document.visibilityState === "visible") announce(queueRef.current);
      }, 25_000);
    }
  }, [announce, setQueue, startMusic]);

  useEffect(() => {
    const onVoicesLoaded = () => {
      if (announcementTimerRef.current && speechIssue) announce(queueRef.current);
    };
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", onVoicesLoaded);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", onVoicesLoaded);
    }
  }, [announce, speechIssue]);

  useEffect(() => () => stop(), [stop]);

  return { queue, setQueue, start, stop, announce, speechIssue };
}
