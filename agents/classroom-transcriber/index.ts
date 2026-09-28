/**
 * Server-side classroom captions — one LiveKit Inference STT stream per speaker.
 * Publishes LiveKit transcriptions so every client can read who said what.
 *
 * Local dev:  npm run transcriber
 * Production: deploy to LiveKit Cloud (see docs/RUNBOOK.md § captions)
 *
 * Requires: LIVEKIT_WS_URL (or LIVEKIT_URL), LIVEKIT_API_KEY, LIVEKIT_API_SECRET
 *           (STT billed via LiveKit Inference — no separate Deepgram API key)
 */
import { config } from "dotenv"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import {
  AutoSubscribe,
  type JobContext,
  cli,
  defineAgent,
  inference,
  ServerOptions,
  WorkerPermissions,
  stt,
} from "@livekit/agents"
import {
  AudioStream,
  type AudioFrame,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  ParticipantKind,
  RoomEvent,
  type Room,
  TrackSource,
} from "@livekit/rtc-node"
import { NoiseGate } from "./noise-gate.js"
import { classifyTranscript } from "./transcript-filter.js"

// Load repo-root .env when started via `npm run transcriber`.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
config({ path: resolve(root, ".env") })

const AGENT_NAME = process.env.LIVEKIT_AGENT_NAME ?? "classroom-transcriber"
const LIVEKIT_URL = process.env.LIVEKIT_WS_URL ?? process.env.LIVEKIT_URL ?? ""

const AUDIO_SAMPLE_RATE = 24000
const AUDIO_CHANNELS = 1

/**
 * Words these lessons use constantly that a general English model mishears —
 * "BSL" came out as "BSO"/"be sell", "fingerspelling" split into two words.
 * Nova-3 keyterm prompting biases recognition toward them. Extend per
 * deployment with CAPTION_KEYTERMS (comma-separated) without a code change.
 */
const CAPTION_KEYTERMS = [
  "BSL",
  "British Sign Language",
  "Deaf",
  "Deaf Signs",
  "fingerspelling",
  "fingerspell",
  "signing",
  "signer",
  "lip-reading",
  "interpreter",
  "breakout room",
  "whiteboard",
  ...(process.env.CAPTION_KEYTERMS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
].slice(0, 100)

/**
 * The class is taught and spoken in the UK. "en-GB" gets British accents and
 * spelling ("colour", "practise") right more often than generic "en".
 * Overridable with CAPTION_LANGUAGE.
 */
const CAPTION_LANGUAGE = process.env.CAPTION_LANGUAGE ?? "en-GB"

/** Low-latency streaming via LiveKit Inference (Deepgram Nova-3 under the hood). */
function makeStt() {
  return new inference.STT({
    model: "deepgram/nova-3",
    language: CAPTION_LANGUAGE,
    modelOptions: {
      interim_results: true,
      punctuate: true,
      smart_format: true,
      endpointing: 200,
      filler_words: false,
      keyterms: CAPTION_KEYTERMS,
    },
  })
}

/** Publishes captions via LiveKit's transcription API (drives TranscriptionReceived in clients). */
class CaptionPublisher {
  private trackSid: string | undefined
  private segmentId: string
  /** Whether anything for the current utterance has reached the clients yet. */
  private published = false

  constructor(
    private readonly room: Room,
    private readonly participantIdentity: string,
  ) {
    this.segmentId = newSegmentId()
    this.refreshTrackSid()
    this.room.on(RoomEvent.TrackPublished, this.onTrackPublished)
  }

  private onTrackPublished = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
    if (
      p.identity === this.participantIdentity &&
      pub.source === TrackSource.SOURCE_MICROPHONE &&
      pub.sid
    ) {
      this.trackSid = pub.sid
    }
  }

  setTrackSid(sid: string) {
    this.trackSid = sid
  }

  refreshTrackSid() {
    const p = this.room.remoteParticipants.get(this.participantIdentity)
    if (!p) return
    for (const pub of p.trackPublications.values()) {
      if (pub.source === TrackSource.SOURCE_MICROPHONE && pub.sid) {
        this.trackSid = pub.sid
        return
      }
    }
  }

  async publish(text: string, final: boolean) {
    const sent = await this.send(text, final)
    if (sent) this.published = true
    if (final) this.startNewSegment()
  }

  /**
   * End the current utterance without publishing it — the filter decided it was
   * background sound rather than speech.
   *
   * If interim text for that utterance is already on screen, an empty final is
   * sent so the client can take the line back. Leaving it would be the worse
   * outcome: a sentence nobody said, stuck mid-transcript with no final to
   * replace it, indistinguishable from something the tutor actually spoke.
   */
  async endSegment(retract: boolean) {
    if (retract && this.published) await this.send("", true)
    this.startNewSegment()
  }

  private startNewSegment() {
    this.segmentId = newSegmentId()
    this.published = false
  }

  /** Returns whether the segment actually went out. */
  private async send(text: string, final: boolean): Promise<boolean> {
    const local = this.room.localParticipant
    if (!local || !this.room.isConnected) return false

    if (!this.trackSid) {
      this.refreshTrackSid()
      if (!this.trackSid) {
        console.warn("[classroom-transcriber] skip publish — no mic trackSid", this.participantIdentity)
        return false
      }
    }

    try {
      await local.publishTranscription({
        participantIdentity: this.participantIdentity,
        trackSid: this.trackSid,
        segments: [
          {
            id: this.segmentId,
            text,
            final,
            startTime: BigInt(0),
            endTime: BigInt(0),
            language: CAPTION_LANGUAGE,
          },
        ],
      })
      return true
    } catch (err) {
      console.error("[classroom-transcriber] publishTranscription failed", {
        identity: this.participantIdentity,
        err,
      })
      return false
    }
  }

  close() {
    this.room.off(RoomEvent.TrackPublished, this.onTrackPublished)
  }
}

function newSegmentId() {
  return `SG_${randomUUID().slice(0, 12)}`
}

/** Subscribe to one participant's microphone and forward PCM frames. */
class SpeakerAudioCapture {
  private closed = false
  private reader: ReadableStreamDefaultReader<AudioFrame> | null = null
  private pumpTask: Promise<void> | null = null

  constructor(
    private readonly room: Room,
    private readonly participantIdentity: string,
    private readonly onFrame: (frame: AudioFrame) => void,
    private readonly onMicTrack?: (trackSid: string) => void,
  ) {
    this.room.on(RoomEvent.TrackSubscribed, this.onTrackSubscribed)
    this.room.on(RoomEvent.TrackUnpublished, this.onTrackUnpublished)
    this.attachExistingMic()
  }

  private attachExistingMic() {
    const participant = this.room.remoteParticipants.get(this.participantIdentity)
    if (!participant) return
    for (const publication of participant.trackPublications.values()) {
      if (publication.source === TrackSource.SOURCE_MICROPHONE && publication.track) {
        if (publication.sid) this.onMicTrack?.(publication.sid)
        this.startReading(publication.track, publication.sid)
        break
      }
    }
  }

  private onTrackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    if (participant.identity !== this.participantIdentity) return
    if (publication.source !== TrackSource.SOURCE_MICROPHONE) return
    if (publication.sid) this.onMicTrack?.(publication.sid)
    this.startReading(track, publication.sid)
  }

  private onTrackUnpublished = (
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    if (participant.identity !== this.participantIdentity) return
    if (publication.source !== TrackSource.SOURCE_MICROPHONE) return
    void this.stopReading()
  }

  private startReading(track: RemoteTrack, trackSid?: string) {
    void this.stopReading()
    console.info("[classroom-transcriber] mic subscribed", {
      identity: this.participantIdentity,
      trackSid: trackSid ?? track.sid,
    })
    const stream = new AudioStream(track, {
      sampleRate: AUDIO_SAMPLE_RATE,
      numChannels: AUDIO_CHANNELS,
    })
    const reader = stream.getReader()
    this.reader = reader
    this.pumpTask = (async () => {
      try {
        while (!this.closed) {
          const { done, value } = await reader.read()
          if (done) break
          this.onFrame(value)
        }
      } catch (err) {
        if (!this.closed) {
          console.error("[classroom-transcriber] mic read failed", {
            identity: this.participantIdentity,
            err,
          })
        }
      } finally {
        reader.releaseLock()
      }
    })()
  }

  private async stopReading() {
    if (this.reader) {
      try {
        await this.reader.cancel()
      } catch {
        /* ignore */
      }
      this.reader = null
    }
    if (this.pumpTask) {
      await this.pumpTask.catch(() => {})
      this.pumpTask = null
    }
  }

  async close() {
    this.closed = true
    this.room.off(RoomEvent.TrackSubscribed, this.onTrackSubscribed)
    this.room.off(RoomEvent.TrackUnpublished, this.onTrackUnpublished)
    await this.stopReading()
  }
}

/**
 * An STT session is held only while this long has passed without speech. Long
 * enough to cover a pause for thought mid-answer, short enough that a student
 * who spoke once doesn't hold a slot for the rest of the lesson.
 */
const STT_IDLE_CLOSE_MS = 20_000

/**
 * After a session dies on its own (provider error, concurrency limit), wait
 * this long before trying another. Otherwise a speaker over the plan's limit
 * reconnects on every word.
 */
const STT_REOPEN_BACKOFF_MS = 5_000

/**
 * After `endInput`, how long the recogniser gets to return the last words
 * before the session is closed outright. `endInput` alone is not enough: the
 * gateway never answers `session.finalize` with `session.closed`, so the
 * socket stays open until the server's ~6 minute inactivity timeout (error
 * 2007) — which the SDK treats as retryable and reconnects. Every idle close
 * left a zombie connection holding a concurrency slot, the project filled up
 * (HTTP 429 MaxConcurrentGatewaySTT, 20/20 in use) and every new speaker was
 * refused.
 */
const STT_FINALIZE_GRACE_MS = 3_000

/**
 * Close a stream and its gateway socket. `stream.close()` alone does not do it
 * once `endInput` has been called: in @livekit/agents 1.4.7 the send loop sets
 * the connection's `closing` flag before `session.finalize`, and the cleanup
 * that would close the socket returns early when that flag is set. The socket
 * then outlives the stream and keeps a concurrency slot until the server's
 * inactivity timeout. `activeWs` is the SDK's handle on the live socket.
 */
function closeStream(stream: stt.SpeechStream) {
  const ws = (stream as unknown as { activeWs?: { close(): void } }).activeWs
  try { stream.close() } catch { /* already gone */ }
  try { ws?.close() } catch { /* already gone */ }
}

/**
 * One STT + transcription publisher per remote speaker.
 * Avoids multiple voice.AgentSession instances on the same room (they conflict on
 * lk.agent.session byte-stream registration in @livekit/agents 1.4.x).
 *
 * The STT session is opened on demand — when the gate hears speech — and closed
 * after a stretch of quiet. Opening one per participant at join time held a
 * provider session for every student with their mic off, and the plan's
 * concurrency limit was used up by the first few people to arrive: everyone
 * after them got no captions at all, for the whole lesson. Sessions now track
 * who is actually talking, which in a signing classroom is a handful at most.
 */
class SpeakerTranscriber {
  private closed = false
  private readonly audioCapture: SpeakerAudioCapture
  private readonly captions: CaptionPublisher
  private speechStream: stt.SpeechStream | null = null
  /** Per-speaker, because each microphone sits in a different room. */
  private readonly gate = new NoiseGate()
  private readonly tasks = new Set<Promise<void>>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  /** Earliest time a new session may be opened after one failed. */
  private reopenAfter = 0

  constructor(
    private readonly room: Room,
    private readonly participant: RemoteParticipant,
  ) {
    this.captions = new CaptionPublisher(this.room, participant.identity)

    this.audioCapture = new SpeakerAudioCapture(
      this.room,
      participant.identity,
      (frame) => {
        if (this.closed) return
        // Only what the gate judges to be speech reaches the recogniser; the
        // rest arrives as silence, which keeps endpointing on schedule.
        const gated = this.gate.push(frame)
        if (this.gate.isOpen) {
          this.ensureStream()
          this.armIdleClose()
        }
        const stream = this.speechStream
        if (!stream) return
        for (const f of gated) stream.pushFrame(f)
      },
      (trackSid) => this.captions.setTrackSid(trackSid),
    )
  }

  private ensureStream() {
    if (this.speechStream || this.closed) return
    if (Date.now() < this.reopenAfter) return
    console.info("[classroom-transcriber] STT open", { identity: this.participant.identity })
    const stream = makeStt().stream()
    this.speechStream = stream
    const task = this.consumeTranscripts(stream)
    this.tasks.add(task)
    void task.finally(() => this.tasks.delete(task))
  }

  private armIdleClose() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      this.releaseStream()
    }, STT_IDLE_CLOSE_MS)
  }

  /**
   * Hand the session back. `endInput` first, so the recogniser finalises what
   * it has, then `close` after a short grace so the connection is actually
   * released (see STT_FINALIZE_GRACE_MS). Closing ends the consume loop.
   */
  private releaseStream() {
    const stream = this.speechStream
    if (!stream) return
    this.speechStream = null
    console.info("[classroom-transcriber] STT idle close", { identity: this.participant.identity })
    try { stream.endInput() } catch { /* already gone */ }
    setTimeout(() => closeStream(stream), STT_FINALIZE_GRACE_MS)
  }

  private async consumeTranscripts(stream: stt.SpeechStream) {
    const identity = this.participant.identity
    try {
      for await (const event of stream) {
        if (this.closed) break

        if (
          event.type !== stt.SpeechEventType.INTERIM_TRANSCRIPT &&
          event.type !== stt.SpeechEventType.FINAL_TRANSCRIPT
        ) continue

        const isFinal = event.type === stt.SpeechEventType.FINAL_TRANSCRIPT
        const alternative = event.alternatives?.[0]
        const text = alternative?.text?.trim() ?? ""
        const confidence = alternative?.confidence ?? 1

        const verdict = classifyTranscript(text, confidence)
        if (!verdict.publish) {
          if (text) {
            console.info("[classroom-transcriber] filtered", {
              identity,
              final: isFinal,
              reason: verdict.reason,
              confidence,
              // The tracked room level for this speaker. If captions go missing
              // for someone, this is the number that says whether the gate is
              // the reason. See docs/RUNBOOK.md § captions.
              noiseFloorDb: this.gate.noiseFloorDb?.toFixed(1),
              text: text.slice(0, 80),
            })
          }
          // A rejected final still ends the utterance: the next thing said has
          // to start a new line rather than overwrite this one. Retract only
          // when there was something to reject — a final with no text at all is
          // ordinary endpointing on silence, not a verdict on anything.
          if (isFinal) await this.captions.endSegment(text.length > 0)
          continue
        }

        console.info("[classroom-transcriber] transcript", {
          identity,
          final: isFinal,
          text: text.slice(0, 80),
        })
        await this.captions.publish(text, isFinal)
      }
    } catch (err) {
      if (!this.closed) {
        console.error("[classroom-transcriber] STT consume failed", {
          identity,
          err,
        })
      }
    } finally {
      // Still the current session means nobody asked it to end: the provider
      // dropped it or refused it (e.g. over the plan's concurrent STT limit).
      // Clear it so the next speech opens a fresh one instead of pushing audio
      // into a dead stream forever.
      if (this.speechStream === stream) {
        this.speechStream = null
        this.reopenAfter = Date.now() + STT_REOPEN_BACKOFF_MS
        if (!this.closed) {
          console.warn("[classroom-transcriber] STT session ended unexpectedly — will reopen on next speech", {
            identity,
          })
        }
      }
      closeStream(stream)
      // Whatever interim was on screen will get no final from this session.
      await this.captions.endSegment(false)
    }
  }

  async close() {
    await this.audioCapture.close()
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    // Let the tail of the last sentence out of the lookahead buffer before the
    // stream is closed, or the final few words never reach the recogniser.
    const stream = this.speechStream
    try {
      if (stream) for (const gated of this.gate.flush()) stream.pushFrame(gated)
    } catch { /* stream already gone */ }
    this.closed = true
    this.captions.close()
    this.speechStream = null
    if (stream) {
      try {
        stream.endInput()
        closeStream(stream)
      } catch {
        /* ignore */
      }
    }
    await Promise.allSettled([...this.tasks])
  }
}

class MultiUserTranscriber {
  private readonly pipelines = new Map<string, SpeakerTranscriber>()
  private readonly closeTasks = new Set<Promise<void>>()

  constructor(private readonly ctx: JobContext) {}

  start() {
    this.ctx.room.on("participantConnected", this.onConnected)
    this.ctx.room.on("participantDisconnected", this.onDisconnected)
  }

  private onConnected = (participant: RemoteParticipant) => {
    void this.attachParticipant(participant)
  }

  private onDisconnected = (participant: RemoteParticipant) => {
    const pipeline = this.pipelines.get(participant.identity)
    if (!pipeline) return
    this.pipelines.delete(participant.identity)
    const task = pipeline.close()
    this.closeTasks.add(task)
    void task.finally(() => this.closeTasks.delete(task))
  }

  private async attachParticipant(participant: RemoteParticipant) {
    if (participant.kind === ParticipantKind.AGENT) return
    if (this.pipelines.has(participant.identity)) return

    console.info("[classroom-transcriber] attaching speaker", {
      room: this.ctx.room.name,
      identity: participant.identity,
      name: participant.name,
    })

    const pipeline = new SpeakerTranscriber(this.ctx.room, participant)
    this.pipelines.set(participant.identity, pipeline)
  }

  async attachExisting() {
    for (const participant of this.ctx.room.remoteParticipants.values()) {
      await this.attachParticipant(participant)
    }
  }

  async close() {
    this.ctx.room.off("participantConnected", this.onConnected)
    this.ctx.room.off("participantDisconnected", this.onDisconnected)
    await Promise.allSettled([
      ...[...this.pipelines.values()].map((p) => p.close()),
      ...this.closeTasks,
    ])
    this.pipelines.clear()
  }
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    console.info("[classroom-transcriber] job started", { room: ctx.room.name })
    const hub = new MultiUserTranscriber(ctx)
    hub.start()
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY)
    console.info("[classroom-transcriber] connected", {
      room: ctx.room.name,
      participants: ctx.room.remoteParticipants.size,
    })
    await hub.attachExisting()
    ctx.addShutdownCallback(() => hub.close())
  },
})

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: AGENT_NAME,
      wsURL: LIVEKIT_URL,
      apiKey: process.env.LIVEKIT_API_KEY,
      apiSecret: process.env.LIVEKIT_API_SECRET,
      permissions: new WorkerPermissions(
        false,  // canPublish — no mic from the agent
        true,   // canSubscribe
        true,   // canPublishData — transcriptions
        false,  // canUpdateMetadata
        [],
        true,   // hidden
      ),
    }),
  )
}
