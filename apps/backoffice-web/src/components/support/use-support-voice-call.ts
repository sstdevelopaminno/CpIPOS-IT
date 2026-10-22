"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export type SupportVoiceCall = {
  id: string;
  conversation_id: string;
  direction: "store_to_it" | "it_to_store";
  status: "requested" | "accepted" | "connecting" | "connected" | "declined" | "cancelled" | "ended" | "failed";
  requested_by_name: string;
  assigned_it_user_id?: string | null;
  assigned_it_name?: string | null;
  assigned_it_role?: string | null;
  signaling_key?: string | null;
  requested_at: string;
  accepted_at?: string | null;
  connected_at?: string | null;
  transfer_status?: "requested" | "accepted" | "completed" | "declined" | "cancelled" | "returning" | null;
  transfer_target_user_id?: string | null;
  transfer_target_name?: string | null;
  transfer_target_role?: "it_admin" | "it_support" | null;
  transfer_requested_by_user_id?: string | null;
  transfer_requested_by_name?: string | null;
  transfer_requested_at?: string | null;
  transfer_accepted_at?: string | null;
  transfer_completed_at?: string | null;
  previous_it_user_id?: string | null;
  previous_it_name?: string | null;
  previous_it_role?: "it_admin" | "it_support" | null;
  transfer_offer_for_me?: boolean;
};

export type SupportVoicePhase =
  | "idle"
  | "requesting_mic"
  | "waiting_peer"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

type VoiceSide = "store" | "it";

type UseSupportVoiceCallOptions = {
  call: SupportVoiceCall | null;
  side: VoiceSide;
  loadIceServers: () => Promise<RTCIceServer[]>;
  onState: (state: "connecting" | "connected") => Promise<void> | void;
  onRemoteHangup?: () => Promise<void> | void;
  held?: boolean;
};

type SignalPayload = {
  side?: VoiceSide;
  instance_id?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

function micErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "กรุณาอนุญาตการใช้ไมโครโฟน เพื่อเริ่มคุยด้วยเสียง";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "ไม่พบไมโครโฟนบนอุปกรณ์นี้";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "ไมโครโฟนกำลังถูกใช้งานโดยแอปอื่น กรุณาปิดแอปนั้นแล้วลองใหม่";
    }
  }
  return error instanceof Error ? error.message : "เปิดไมโครโฟนไม่สำเร็จ";
}

export function formatVoiceDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function useSupportVoiceCall({
  call,
  side,
  loadIceServers,
  onState,
  onRemoteHangup,
  held = false
}: UseSupportVoiceCallOptions) {
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const realtimeClientRef = useRef<ReturnType<typeof getSupabaseBrowserClient> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const readyIntervalRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const elapsedStartedAtRef = useRef<number | null>(null);
  const queuedIceRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteReadyRef = useRef(false);
  const offerSentRef = useRef(false);
  const runningRef = useRef(false);
  const instanceIdRef = useRef("");
  const remoteInstanceRef = useRef("");
  const recoveryAttemptsRef = useRef(0);
  const recoverConnectionRef = useRef<() => void>(() => undefined);
  const signalingKeyRef = useRef(call?.signaling_key ?? "");
  const holdAudioRef = useRef<{ context: AudioContext; source: AudioBufferSourceNode } | null>(null);

  const [phase, setPhase] = useState<SupportVoicePhase>("idle");
  const [error, setError] = useState("");
  const [micMuted, setMicMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [needsAudioResume, setNeedsAudioResume] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const isInitiator = Boolean(call) && (
    (call!.direction === "store_to_it" && side === "store") ||
    (call!.direction === "it_to_store" && side === "it")
  );

  const stopElapsed = useCallback(() => {
    if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
  }, []);

  const startElapsed = useCallback(() => {
    stopElapsed();
    if (!elapsedStartedAtRef.current) elapsedStartedAtRef.current = Date.now();
    const tick = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - (elapsedStartedAtRef.current ?? Date.now())) / 1000)));
    };
    tick();
    elapsedTimerRef.current = window.setInterval(tick, 1000);
  }, [stopElapsed]);

  const stopHoldMusic = useCallback(() => {
    const current = holdAudioRef.current;
    holdAudioRef.current = null;
    if (!current) return;
    try { current.source.stop(); } catch {}
    void current.context.close().catch(() => null);
  }, []);

  const startHoldMusic = useCallback(async () => {
    if (holdAudioRef.current || typeof window === "undefined") return;
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    try {
      const context = new AudioContextCtor();
      const seconds = 8;
      const frameCount = Math.floor(context.sampleRate * seconds);
      const buffer = context.createBuffer(1, frameCount, context.sampleRate);
      const data = buffer.getChannelData(0);
      const notes = [261.63, 329.63, 392.0, 329.63, 293.66, 349.23, 440.0, 349.23];
      const noteFrames = Math.floor(context.sampleRate);
      for (let i = 0; i < frameCount; i += 1) {
        const noteIndex = Math.min(notes.length - 1, Math.floor(i / noteFrames));
        const phaseInNote = (i % noteFrames) / noteFrames;
        const envelope = Math.sin(Math.PI * Math.min(1, phaseInNote * 4)) * Math.sin(Math.PI * Math.min(1, (1 - phaseInNote) * 4));
        data[i] = Math.sin(2 * Math.PI * notes[noteIndex] * (i / context.sampleRate)) * envelope * 0.045;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(context.destination);
      holdAudioRef.current = { context, source };
      source.start();
      if (context.state === "suspended") await context.resume().catch(() => null);
    } catch {
      stopHoldMusic();
    }
  }, [stopHoldMusic]);

  const cleanup = useCallback(async (notifyPeer: boolean) => {
    runningRef.current = false;
    remoteReadyRef.current = false;
    offerSentRef.current = false;
    queuedIceRef.current = [];
    remoteInstanceRef.current = "";
    recoveryAttemptsRef.current = 0;

    if (readyIntervalRef.current) window.clearInterval(readyIntervalRef.current);
    if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
    readyIntervalRef.current = null;
    disconnectTimerRef.current = null;
    stopElapsed();
    elapsedStartedAtRef.current = null;

    const channel = channelRef.current;
    channelRef.current = null;
    if (channel) {
      if (notifyPeer) {
        await channel.send({
          type: "broadcast",
          event: "voice_hangup",
          payload: { side, instance_id: instanceIdRef.current }
        }).catch(() => null);
      }
      const supabase = realtimeClientRef.current;
      if (supabase) await supabase.removeChannel(channel).catch(() => null);
      realtimeClientRef.current = null;
    }

    peerRef.current?.close();
    peerRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;

    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.srcObject = null;
    }
    audioElementRef.current = null;

    setMicMuted(false);
    setSpeakerMuted(false);
    setNeedsAudioResume(false);
    setElapsedSeconds(0);
  }, [side, stopElapsed]);

  const attachRemoteStream = useCallback((stream: MediaStream) => {
    remoteStreamRef.current = stream;
    audioElementRef.current?.pause();
    const audio = new Audio();
    audio.autoplay = true;
    audio.preload = "auto";
    audio.srcObject = stream;
    audio.muted = held || speakerMuted;
    audioElementRef.current = audio;
    void audio.play().then(() => {
      setNeedsAudioResume(false);
    }).catch(() => {
      setNeedsAudioResume(true);
    });
  }, [held, speakerMuted]);

  const flushQueuedIce = useCallback(async () => {
    const pc = peerRef.current;
    if (!pc?.remoteDescription) return;
    const pending = queuedIceRef.current.splice(0);
    for (const candidate of pending) {
      await pc.addIceCandidate(candidate).catch(() => null);
    }
  }, []);

  const sendReady = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || !runningRef.current) return;
    void channel.send({
      type: "broadcast",
      event: "voice_ready",
      payload: { side, instance_id: instanceIdRef.current }
    });
  }, [side]);

  const createOffer = useCallback(async (iceRestart = false) => {
    const pc = peerRef.current;
    const channel = channelRef.current;
    if (!pc || !channel || !runningRef.current || (offerSentRef.current && !iceRestart)) return;
    if (!remoteReadyRef.current || !isInitiator) return;

    offerSentRef.current = true;
    try {
      setPhase(iceRestart ? "reconnecting" : "connecting");
      const offer = await pc.createOffer({ offerToReceiveAudio: true, iceRestart });
      await pc.setLocalDescription(offer);
      await channel.send({
        type: "broadcast",
        event: "webrtc_offer",
        payload: {
          side,
          instance_id: instanceIdRef.current,
          description: pc.localDescription
        }
      });
    } catch (cause) {
      offerSentRef.current = false;
      if (!iceRestart) {
        setPhase("failed");
        setError(cause instanceof Error ? cause.message : "สร้างการเชื่อมต่อเสียงไม่สำเร็จ");
      }
    }
  }, [isInitiator, side]);

  const recoverConnection = useCallback(async () => {
    const pc = peerRef.current;
    const channel = channelRef.current;
    if (!pc || !channel || !runningRef.current || pc.connectionState === "connected") return;

    if (recoveryAttemptsRef.current >= 3) {
      setPhase("failed");
      setError("การเชื่อมต่อเสียงขาดและลองเชื่อมต่อใหม่แล้ว กรุณาตรวจเครือข่ายหรือ TURN Server");
      return;
    }

    recoveryAttemptsRef.current += 1;
    setPhase("reconnecting");
    setError("");

    try {
      const iceServers = await loadIceServers();
      pc.setConfiguration({ iceServers });
      if (isInitiator) {
        remoteReadyRef.current = true;
        offerSentRef.current = false;
        await createOffer(true);
      } else {
        await channel.send({
          type: "broadcast",
          event: "webrtc_restart_request",
          payload: { side, instance_id: instanceIdRef.current }
        });
      }
    } catch {
      // Retry timer below handles transient API/network failures.
    }

    if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
    disconnectTimerRef.current = window.setTimeout(() => {
      if (peerRef.current && peerRef.current.connectionState !== "connected") {
        recoverConnectionRef.current();
      }
    }, 10_000);
  }, [createOffer, isInitiator, loadIceServers, side]);

  useEffect(() => {
    recoverConnectionRef.current = () => {
      void recoverConnection();
    };
    return () => {
      recoverConnectionRef.current = () => undefined;
    };
  }, [recoverConnection]);

  const start = useCallback(async () => {
    if (!call || !["accepted", "connecting", "connected"].includes(call.status)) {
      setError("คำขอคุยด้วยเสียงยังไม่พร้อม");
      return;
    }
    if (!call.signaling_key) {
      setError("กำลังเตรียมห้องเสียง กรุณารอสักครู่แล้วลองใหม่");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      setError("อุปกรณ์หรือเบราว์เซอร์นี้ยังไม่รองรับการคุยด้วยเสียงผ่านเว็บ");
      return;
    }

    await cleanup(false);
    signalingKeyRef.current = call.signaling_key;
    setError("");
    setPhase("requesting_mic");
    runningRef.current = true;
    instanceIdRef.current = crypto.randomUUID();

    let localStream: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      localStream = stream;
      localStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !held;
      });
      const iceServers = await loadIceServers();

      const pc = new RTCPeerConnection({
        iceServers,
        bundlePolicy: "max-bundle"
      });
      peerRef.current = pc;

      for (const track of stream.getAudioTracks()) {
        pc.addTrack(track, stream);
      }

      pc.ontrack = (event) => {
        const streamFromEvent = event.streams[0];
        if (streamFromEvent) {
          attachRemoteStream(streamFromEvent);
          return;
        }
        const remote = remoteStreamRef.current ?? new MediaStream();
        remote.addTrack(event.track);
        attachRemoteStream(remote);
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate || !channelRef.current) return;
        void channelRef.current.send({
          type: "broadcast",
          event: "webrtc_ice",
          payload: {
            side,
            instance_id: instanceIdRef.current,
            candidate: event.candidate.toJSON()
          }
        });
      };

      pc.onconnectionstatechange = () => {
        if (!runningRef.current) return;
        const state = pc.connectionState;
        if (state === "connected") {
          if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
          recoveryAttemptsRef.current = 0;
          setPhase("connected");
          setError("");
          startElapsed();
          void Promise.resolve(onState("connected")).catch(() => null);
        } else if (state === "connecting") {
          setPhase("connecting");
        } else if (state === "disconnected" || state === "failed") {
          void recoverConnection();
        }
      };

      const supabase = getSupabaseBrowserClient();
      realtimeClientRef.current = supabase;
      const topic = `support-voice:${call.id}:${call.signaling_key}`;
      const channel = supabase
        .channel(topic)
        .on("broadcast", { event: "voice_ready" }, ({ payload }) => {
          const event = payload as SignalPayload;
          if (event.side === side || !event.instance_id) return;

          if (remoteInstanceRef.current && remoteInstanceRef.current !== event.instance_id) {
            offerSentRef.current = false;
          }
          remoteInstanceRef.current = event.instance_id;
          remoteReadyRef.current = true;
          sendReady();
          if (isInitiator) void createOffer();
        })
        .on("broadcast", { event: "webrtc_offer" }, ({ payload }) => {
          const event = payload as SignalPayload;
          const description = event.description;
          if (event.side === side || !description || isInitiator) return;
          void (async () => {
            const activePeer = peerRef.current;
            const activeChannel = channelRef.current;
            if (!activePeer || !activeChannel) return;
            try {
              setPhase(activePeer.connectionState === "connected" ? "reconnecting" : "connecting");
              await activePeer.setRemoteDescription(description);
              await flushQueuedIce();
              const answer = await activePeer.createAnswer();
              await activePeer.setLocalDescription(answer);
              await activeChannel.send({
                type: "broadcast",
                event: "webrtc_answer",
                payload: {
                  side,
                  instance_id: instanceIdRef.current,
                  description: activePeer.localDescription
                }
              });
            } catch (cause) {
              setPhase("failed");
              setError(cause instanceof Error ? cause.message : "ตอบรับการเชื่อมต่อเสียงไม่สำเร็จ");
            }
          })();
        })
        .on("broadcast", { event: "webrtc_answer" }, ({ payload }) => {
          const event = payload as SignalPayload;
          const description = event.description;
          if (event.side === side || !description || !isInitiator) return;
          void (async () => {
            const activePeer = peerRef.current;
            if (!activePeer) return;
            try {
              await activePeer.setRemoteDescription(description);
              await flushQueuedIce();
            } catch (cause) {
              setPhase("failed");
              setError(cause instanceof Error ? cause.message : "ยืนยันการเชื่อมต่อเสียงไม่สำเร็จ");
            }
          })();
        })
        .on("broadcast", { event: "webrtc_ice" }, ({ payload }) => {
          const event = payload as SignalPayload;
          if (event.side === side || !event.candidate) return;
          const activePeer = peerRef.current;
          if (!activePeer) return;
          if (!activePeer.remoteDescription) {
            queuedIceRef.current.push(event.candidate);
            return;
          }
          void activePeer.addIceCandidate(event.candidate).catch(() => null);
        })
        .on("broadcast", { event: "webrtc_restart_request" }, ({ payload }) => {
          const event = payload as SignalPayload;
          if (event.side === side || !isInitiator) return;
          void recoverConnection();
        })
        .on("broadcast", { event: "voice_hangup" }, ({ payload }) => {
          const event = payload as SignalPayload;
          if (event.side === side) return;
          void cleanup(false).then(() => {
            setPhase("idle");
            void Promise.resolve(onRemoteHangup?.()).catch(() => null);
          });
        })
        .subscribe((status) => {
          if (!runningRef.current) return;
          if (status === "SUBSCRIBED") {
            if (peerRef.current?.connectionState !== "connected") setPhase("waiting_peer");
            void Promise.resolve(onState("connecting")).catch(() => null);
            sendReady();
            if (readyIntervalRef.current) window.clearInterval(readyIntervalRef.current);
            readyIntervalRef.current = window.setInterval(() => {
              if (remoteReadyRef.current) {
                if (readyIntervalRef.current) window.clearInterval(readyIntervalRef.current);
                readyIntervalRef.current = null;
                if (isInitiator) void createOffer();
                return;
              }
              sendReady();
            }, 900);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            // Realtime signaling can reconnect independently. Do not kill a healthy
            // WebRTC media path merely because a browser backgrounded its WebSocket.
            if (peerRef.current?.connectionState !== "connected") {
              setPhase("reconnecting");
              void recoverConnection();
            }
          }
        });

      channelRef.current = channel;
    } catch (cause) {
      localStream?.getTracks().forEach((track) => track.stop());
      runningRef.current = false;
      setPhase("failed");
      setError(micErrorMessage(cause));
    }
  }, [
    attachRemoteStream,
    call,
    cleanup,
    createOffer,
    flushQueuedIce,
    held,
    isInitiator,
    loadIceServers,
    onRemoteHangup,
    onState,
    recoverConnection,
    sendReady,
    side,
    startElapsed
  ]);

  const endLocal = useCallback(async () => {
    await cleanup(true);
    setPhase("idle");
  }, [cleanup]);

  const toggleMic = useCallback(() => {
    const nextMuted = !micMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted && !held;
    });
    setMicMuted(nextMuted);
  }, [held, micMuted]);

  const toggleSpeaker = useCallback(() => {
    const nextMuted = !speakerMuted;
    if (audioElementRef.current) audioElementRef.current.muted = nextMuted || held;
    setSpeakerMuted(nextMuted);
  }, [held, speakerMuted]);

  const resumeAudio = useCallback(async () => {
    if (!audioElementRef.current) return;
    try {
      await audioElementRef.current.play();
      setNeedsAudioResume(false);
    } catch {
      setNeedsAudioResume(true);
    }
  }, []);

  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !held && !micMuted;
    });
    if (audioElementRef.current) {
      audioElementRef.current.muted = held || speakerMuted;
    }
    if (held) void startHoldMusic();
    else stopHoldMusic();
  }, [held, micMuted, speakerMuted, startHoldMusic, stopHoldMusic]);

  useEffect(() => {
    const nextKey = call?.signaling_key ?? "";
    const previousKey = signalingKeyRef.current;
    signalingKeyRef.current = nextKey;

    if (
      runningRef.current &&
      previousKey &&
      nextKey &&
      previousKey !== nextKey &&
      call &&
      ["accepted", "connecting", "connected"].includes(call.status)
    ) {
      void cleanup(false).then(() => {
        setPhase("idle");
        window.setTimeout(() => void start(), 0);
      });
    }
  }, [call, cleanup, start]);

  useEffect(() => {
    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        runningRef.current &&
        peerRef.current &&
        peerRef.current.connectionState !== "connected"
      ) {
        void recoverConnection();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [recoverConnection]);

  useEffect(() => {
    return () => {
      stopHoldMusic();
      void cleanup(false);
    };
  }, [cleanup, stopHoldMusic]);

  useEffect(() => {
    if (!call || !["accepted", "connecting", "connected"].includes(call.status)) {
      if (runningRef.current) void cleanup(false);
      setPhase("idle");
    }
  }, [call, cleanup]);

  return {
    phase,
    error,
    micMuted,
    speakerMuted,
    needsAudioResume,
    elapsedSeconds,
    start,
    endLocal,
    toggleMic,
    toggleSpeaker,
    resumeAudio,
    canStart: Boolean(call?.signaling_key) && ["accepted", "connecting", "connected"].includes(call?.status ?? "")
  };
}
