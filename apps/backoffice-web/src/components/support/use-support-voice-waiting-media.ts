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
      stop();
    }
  }, [stop]);

  const announce = useCallback((snapshot: VoiceQueueSnapshot | null = queueRef.current) => {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) return;

    const message = snapshot?.position
      ? snapshot.position > 1
        ? `ขณะนี้เจ้าหน้าที่กำลังให้บริการลูกค้าท่านอื่น กรุณารอสักครู่ คุณอยู่ในคิวลำดับที่ ${snapshot.position}`
        : "ขณะนี้คุณอยู่คิวแรก กรุณารอสักครู่ เจ้าหน้าที่จะรับสายของคุณโดยเร็วที่สุด"
      : "ยินดีต้อนรับสู่ CpiPOS Support ขณะนี้กำลังติดต่อเจ้าหน้าที่ กรุณารอสักครู่";

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = "th-TH";
      utterance.rate = 0.92;
      utterance.pitch = 1;
      utterance.volume = 1;
      // Duck the local waiting melody while Thai TTS speaks so callers can
      // understand the announcement even with small Android speakers.
      utterance.onstart = () => {
        const playing = audioRef.current;
        if (playing) playing.gain.gain.setTargetAtTime(0.14, playing.context.currentTime, 0.05);
      };
      const restoreMusic = () => {
        const playing = audioRef.current;
        if (playing) playing.gain.gain.setTargetAtTime(0.85, playing.context.currentTime, 0.15);
      };
      utterance.onend = restoreMusic;
      utterance.onerror = restoreMusic;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Visible queue text and generated waiting music remain as fallback.
    }
  }, []);

  const start = useCallback((initialQueue?: VoiceQueueSnapshot | null) => {
    if (initialQueue !== undefined) {
      setQueue(initialQueue);
      announce(initialQueue);
    }
    void startMusic();

    if (!announcementTimerRef.current) {
      announcementTimerRef.current = window.setInterval(() => {
        if (document.visibilityState === "visible") announce(queueRef.current);
      }, 60_000);
    }
  }, [announce, setQueue, startMusic]);

  useEffect(() => () => stop(), [stop]);

  return { queue, setQueue, start, stop, announce };
}
