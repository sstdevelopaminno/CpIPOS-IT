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
  onRemoteHangup
}: UseSupportVoiceCallOptions) {
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const realtimeClientRef = useRef<ReturnType<typeof getSupabaseBrowserClient> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const readyIntervalRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const queuedIceRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteReadyRef = useRef(false);
  const offerSentRef = useRef(false);
  const runningRef = useRef(false);
  const instanceIdRef = useRef("");
  const remoteInstanceRef = useRef("");

  const [phase, setPhase] = useState<SupportVoicePhase>("idle");
  const [error, setError] = useState("");
  const [micMuted, setMicMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [needsAudioResume, setNeedsAudioResume] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const attachAudioElement = useCallback((node: HTMLAudioElement | null) => {
    remoteAudioRef.current = node;
    if (node && remoteStreamRef.current) {
      node.srcObject = remoteStreamRef.current;
    }
  }, []);

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
    const startedAt = Date.now();
    setElapsedSeconds(0);
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
  }, [stopElapsed]);

  const cleanup = useCallback(async (notifyPeer: boolean) => {
    runningRef.current = false;
    remoteReadyRef.current = false;
    offerSentRef.current = false;
    queuedIceRef.current = [];
    remoteInstanceRef.current = "";

    if (readyIntervalRef.current) window.clearInterval(readyIntervalRef.current);
    if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
    readyIntervalRef.current = null;
    disconnectTimerRef.current = null;
    stopElapsed();

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

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
    }

    setMicMuted(false);
    setSpeakerMuted(false);
    setNeedsAudioResume(false);
    setElapsedSeconds(0);
  }, [side, stopElapsed]);

  const attachRemoteStream = useCallback((stream: MediaStream) => {
    remoteStreamRef.current = stream;
    const audio = remoteAudioRef.current;
    if (!audio) return;
    audio.srcObject = stream;
    audio.muted = speakerMuted;
    void audio.play().then(() => {
      setNeedsAudioResume(false);
    }).catch(() => {
      setNeedsAudioResume(true);
    });
  }, [speakerMuted]);

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

  const createOffer = useCallback(async () => {
    const pc = peerRef.current;
    const channel = channelRef.current;
    if (!pc || !channel || !runningRef.current || offerSentRef.current) return;
    if (!remoteReadyRef.current || !isInitiator) return;

    offerSentRef.current = true;
    try {
      setPhase("connecting");
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
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
      setPhase("failed");
      setError(cause instanceof Error ? cause.message : "สร้างการเชื่อมต่อเสียงไม่สำเร็จ");
    }
  }, [isInitiator, side]);

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
          setPhase("connected");
          setError("");
          startElapsed();
          void Promise.resolve(onState("connected")).catch(() => null);
        } else if (state === "connecting") {
          setPhase("connecting");
        } else if (state === "disconnected") {
          setPhase("reconnecting");
          if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = window.setTimeout(() => {
            if (peerRef.current?.connectionState === "disconnected") {
              setPhase("failed");
              setError("การเชื่อมต่อเสียงขาด กรุณาลองเชื่อมต่อใหม่");
            }
          }, 8000);
        } else if (state === "failed") {
          setPhase("failed");
          setError("เชื่อมต่อเสียงไม่สำเร็จ เครือข่ายนี้อาจต้องใช้ TURN Server");
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
              setPhase("connecting");
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
            setPhase("waiting_peer");
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
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setPhase("failed");
            setError("เชื่อมต่อช่องสัญญาณเสียงไม่สำเร็จ กรุณาลองใหม่");
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
    isInitiator,
    loadIceServers,
    onRemoteHangup,
    onState,
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
      track.enabled = !nextMuted;
    });
    setMicMuted(nextMuted);
  }, [micMuted]);

  const toggleSpeaker = useCallback(() => {
    const nextMuted = !speakerMuted;
    if (remoteAudioRef.current) remoteAudioRef.current.muted = nextMuted;
    setSpeakerMuted(nextMuted);
  }, [speakerMuted]);

  const resumeAudio = useCallback(async () => {
    if (!remoteAudioRef.current) return;
    try {
      await remoteAudioRef.current.play();
      setNeedsAudioResume(false);
    } catch {
      setNeedsAudioResume(true);
    }
  }, []);

  useEffect(() => {
    const notifyPeerOnPageHide = () => {
      if (!runningRef.current || !channelRef.current) return;
      void channelRef.current.send({
        type: "broadcast",
        event: "voice_hangup",
        payload: { side, instance_id: instanceIdRef.current }
      });
    };
    window.addEventListener("pagehide", notifyPeerOnPageHide);
    return () => window.removeEventListener("pagehide", notifyPeerOnPageHide);
  }, [side]);

  useEffect(() => {
    return () => {
      void cleanup(false);
    };
  }, [cleanup]);

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
    attachAudioElement,
    start,
    endLocal,
    toggleMic,
    toggleSpeaker,
    resumeAudio,
    canStart: Boolean(call?.signaling_key) && ["accepted", "connecting", "connected"].includes(call?.status ?? "")
  };
}
