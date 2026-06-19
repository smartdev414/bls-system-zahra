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

// Load repo-root .env when started via `npm run transcriber`.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
config({ path: resolve(root, ".env") })

const AGENT_NAME = process.env.LIVEKIT_AGENT_NAME ?? "classroom-transcriber"
const LIVEKIT_URL = process.env.LIVEKIT_WS_URL ?? process.env.LIVEKIT_URL ?? ""

const AUDIO_SAMPLE_RATE = 24000
const AUDIO_CHANNELS = 1

/** Low-latency streaming via LiveKit Inference (Deepgram Nova-3 under the hood). */
function makeStt() {
  return new inference.STT({
    model: "deepgram/nova-3",
    language: "en",
    modelOptions: {
      interim_results: true,
      punctuate: true,
      smart_format: true,
      endpointing: 200,
      filler_words: false,
    },
  })
}

/** Publishes captions via LiveKit's transcription API (drives TranscriptionReceived in clients). */
class CaptionPublisher {
  private trackSid: string | undefined
  private segmentId: string

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
    const local = this.room.localParticipant
    if (!local || !this.room.isConnected) return

    if (!this.trackSid) {
      this.refreshTrackSid()
      if (!this.trackSid) {
        console.warn("[classroom-transcriber] skip publish — no mic trackSid", this.participantIdentity)
        return
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
            language: "en",
          },
        ],
      })
      if (final) this.segmentId = newSegmentId()
    } catch (err) {
      console.error("[classroom-transcriber] publishTranscription failed", {
        identity: this.participantIdentity,
        err,
      })
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
 * One STT + transcription publisher per remote speaker.
 * Avoids multiple voice.AgentSession instances on the same room (they conflict on
 * lk.agent.session byte-stream registration in @livekit/agents 1.4.x).
 */
class SpeakerTranscriber {
  private closed = false
  private readonly audioCapture: SpeakerAudioCapture
  private readonly captions: CaptionPublisher
  private readonly speechStream: stt.SpeechStream
  private readonly tasks: Promise<void>[] = []

  constructor(
    private readonly room: Room,
    participant: RemoteParticipant,
  ) {
    this.captions = new CaptionPublisher(this.room, participant.identity)

    this.speechStream = makeStt().stream()
    this.audioCapture = new SpeakerAudioCapture(
      this.room,
      participant.identity,
      (frame) => {
        if (!this.closed) this.speechStream.pushFrame(frame)
      },
      (trackSid) => this.captions.setTrackSid(trackSid),
    )
    this.tasks.push(this.consumeTranscripts(participant.identity))
  }

  private async consumeTranscripts(identity: string) {
    try {
      for await (const event of this.speechStream) {
        if (this.closed) break

        const text = event.alternatives?.[0]?.text?.trim()
        if (!text) continue

        if (
          event.type === stt.SpeechEventType.INTERIM_TRANSCRIPT ||
          event.type === stt.SpeechEventType.FINAL_TRANSCRIPT
        ) {
          const isFinal = event.type === stt.SpeechEventType.FINAL_TRANSCRIPT
          console.info("[classroom-transcriber] transcript", {
            identity,
            final: isFinal,
            text: text.slice(0, 80),
          })
          await this.captions.publish(text, isFinal)
        }
      }
    } catch (err) {
      if (!this.closed) {
        console.error("[classroom-transcriber] STT consume failed", {
          identity,
          err,
        })
      }
    }
  }

  async close() {
    this.closed = true
    this.captions.close()
    await this.audioCapture.close()
    try {
      this.speechStream.endInput()
      this.speechStream.close()
    } catch {
      /* ignore */
    }
    await Promise.allSettled(this.tasks)
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
