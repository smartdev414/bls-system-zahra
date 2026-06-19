/**
 * Server-side classroom captions — one LiveKit Inference STT session per speaker.
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
import {
  AutoSubscribe,
  type JobContext,
  cli,
  defineAgent,
  inference,
  ServerOptions,
  WorkerPermissions,
  voice,
} from "@livekit/agents"
import {
  type RemoteParticipant,
  ParticipantKind,
} from "@livekit/rtc-node"

// Load repo-root .env when started via `npm run transcriber`.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
config({ path: resolve(root, ".env") })

const AGENT_NAME = process.env.LIVEKIT_AGENT_NAME ?? "classroom-transcriber"
const LIVEKIT_URL = process.env.LIVEKIT_WS_URL ?? process.env.LIVEKIT_URL ?? ""

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

class Transcriber extends voice.Agent {
  constructor(readonly participantIdentity: string) {
    super({
      instructions: "not-needed",
      stt: makeStt(),
    })
  }

  async onUserTurnCompleted(): Promise<void> {
    // Transcription-only — never call an LLM or speak back.
    throw new voice.StopResponse()
  }
}

class MultiUserTranscriber {
  private sessions = new Map<string, voice.AgentSession>()
  private tasks = new Set<Promise<void>>()

  constructor(private readonly ctx: JobContext) {}

  start() {
    this.ctx.room.on("participantConnected", this.onConnected)
    this.ctx.room.on("participantDisconnected", this.onDisconnected)
  }

  private onConnected = (participant: RemoteParticipant) => {
    void this.attachParticipant(participant)
  }

  private onDisconnected = (participant: RemoteParticipant) => {
    const session = this.sessions.get(participant.identity)
    if (!session) return
    this.sessions.delete(participant.identity)
    const task = (async () => {
      try {
        await session.close()
      } catch {
        /* room may already be gone */
      }
    })()
    this.tasks.add(task)
    void task.finally(() => this.tasks.delete(task))
  }

  private async attachParticipant(participant: RemoteParticipant) {
    if (participant.kind === ParticipantKind.AGENT) return
    if (this.sessions.has(participant.identity)) return

    console.info("[classroom-transcriber] attaching speaker", {
      room: this.ctx.room.name,
      identity: participant.identity,
      name: participant.name,
    })

    const session = new voice.AgentSession({
      turnHandling: { turnDetection: "stt" },
    })

    await session.start({
      agent: new Transcriber(participant.identity),
      room: this.ctx.room,
      inputOptions: {
        participantIdentity: participant.identity,
        audioEnabled: true,
        textEnabled: false,
        videoEnabled: false,
        closeOnDisconnect: false,
      },
      outputOptions: {
        audioEnabled: false,
        transcriptionEnabled: true,
        // Don't wait for TTS sync — push interim/final text immediately.
        syncTranscription: false,
      },
      record: false,
    })

    this.sessions.set(participant.identity, session)
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
      ...[...this.sessions.values()].map((s) => s.close()),
      ...this.tasks,
    ])
    this.sessions.clear()
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
