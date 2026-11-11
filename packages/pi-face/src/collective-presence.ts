import { measureCollectiveOrder, type CollectiveOrder } from "./collective-kernel.ts";
import { AgentFaceEngine, type AgentFaceEvent, type AgentFaceFrame } from "./presence.ts";
import type { SwarmHomeForm } from "./swarm.ts";

export type PresenceNetworkEvent =
  | { type: "agent_added"; agentId: string; label?: string; form?: SwarmHomeForm }
  | { type: "agent_removed"; agentId: string }
  | { type: "agent_event"; agentId: string; event: AgentFaceEvent }
  | { type: "handoff_started"; handoffId: string; from: string; to: string; artifactId: string }
  | { type: "handoff_completed"; handoffId: string; isError?: boolean };

export interface PresenceEvidenceEntry {
  sequence: number;
  at: number;
  event: PresenceNetworkEvent;
  before: Record<string, string>;
  after: Record<string, string>;
}

export interface AgentViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CollectiveAgentFrame {
  agentId: string;
  label: string;
  viewport: AgentViewport;
  frame: AgentFaceFrame;
  order: CollectiveOrder;
}

export interface HandoffParticle {
  x: number;
  y: number;
  phase: number;
}

export interface CollectiveHandoffFrame {
  handoffId: string;
  from: string;
  to: string;
  artifactId: string;
  status: "active" | "completed" | "error";
  progress: number;
  particles: readonly HandoffParticle[];
}

export interface AgentPresenceNetworkFrame {
  time: number;
  sequence: number;
  agents: readonly CollectiveAgentFrame[];
  handoffs: readonly CollectiveHandoffFrame[];
}

type AgentEntry = {
  label: string;
  engine: AgentFaceEngine;
};

type HandoffEntry = {
  handoffId: string;
  from: string;
  to: string;
  artifactId: string;
  status: "active" | "completed" | "error";
  progress: number;
  resolvedAge: number;
  phase: number;
};

function hash32(value: string) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function viewportFor(index: number, count: number): AgentViewport {
  if (count <= 1) return { x: 0.2, y: 0.12, width: 0.6, height: 0.72 };
  if (count === 2) return { x: index === 0 ? 0.04 : 0.54, y: 0.15, width: 0.42, height: 0.68 };
  if (count === 3) {
    if (index === 0) return { x: 0.3, y: 0.03, width: 0.4, height: 0.42 };
    return { x: index === 1 ? 0.05 : 0.55, y: 0.52, width: 0.4, height: 0.42 };
  }
  const columns = 2;
  const row = Math.floor(index / columns);
  const column = index % columns;
  return { x: 0.04 + column * 0.5, y: 0.04 + row * 0.48, width: 0.42, height: 0.42 };
}

function viewportCenter(viewport: AgentViewport) {
  return { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
}

function moods(agents: ReadonlyMap<string, AgentEntry>) {
  return Object.fromEntries([...agents.entries()].map(([id, entry]) => [id, entry.engine.mood]));
}

export class AgentPresenceNetwork {
  private readonly agents = new Map<string, AgentEntry>();
  private readonly handoffs = new Map<string, HandoffEntry>();
  private readonly tape: PresenceEvidenceEntry[] = [];
  private time = 0;
  private sequence = 0;
  private readonly seed: number;

  constructor(seed = 1701) {
    this.seed = seed;
  }

  dispatch(event: PresenceNetworkEvent, record = true): AgentPresenceNetworkFrame {
    const before = moods(this.agents);
    if (event.type === "agent_added") {
      if (this.agents.has(event.agentId)) throw new Error(`Agent already exists: ${event.agentId}`);
      this.agents.set(event.agentId, {
        label: event.label ?? event.agentId,
        engine: new AgentFaceEngine(hash32(`${this.seed}:${event.agentId}`), "idle", event.form ?? "emergent-face"),
      });
    } else if (event.type === "agent_removed") {
      if (!this.agents.delete(event.agentId)) throw new Error(`Unknown agent: ${event.agentId}`);
      for (const [handoffId, handoff] of this.handoffs) {
        if (handoff.from === event.agentId || handoff.to === event.agentId) this.handoffs.delete(handoffId);
      }
    } else if (event.type === "agent_event") {
      const agent = this.agents.get(event.agentId);
      if (!agent) throw new Error(`Unknown agent: ${event.agentId}`);
      agent.engine.dispatch(event.event);
    } else if (event.type === "handoff_started") {
      if (!this.agents.has(event.from) || !this.agents.has(event.to)) {
        throw new Error(`Handoff endpoints must exist: ${event.from} -> ${event.to}`);
      }
      this.handoffs.set(event.handoffId, {
        ...event,
        status: "active",
        progress: 0,
        resolvedAge: 0,
        phase: hash32(`${this.seed}:${event.handoffId}`) / 0x100000000 * Math.PI * 2,
      });
    } else if (event.type === "handoff_completed") {
      const handoff = this.handoffs.get(event.handoffId);
      if (!handoff) throw new Error(`Unknown handoff: ${event.handoffId}`);
      handoff.status = event.isError ? "error" : "completed";
      handoff.progress = 1;
      handoff.resolvedAge = 0;
    }

    if (record) {
      this.sequence++;
      this.tape.push({
        sequence: this.sequence,
        at: this.time,
        event: structuredClone(event),
        before,
        after: moods(this.agents),
      });
    }
    return this.snapshot();
  }

  advanceTime(milliseconds: number): AgentPresenceNetworkFrame {
    const elapsed = Math.max(0, Math.min(250, milliseconds));
    this.time += elapsed;
    for (const agent of this.agents.values()) agent.engine.advanceTime(elapsed);
    for (const [handoffId, handoff] of this.handoffs) {
      if (handoff.status === "active") {
        handoff.progress = Math.min(0.94, handoff.progress + elapsed / 2200);
      } else {
        handoff.resolvedAge += elapsed;
        if (handoff.resolvedAge > 1400) this.handoffs.delete(handoffId);
      }
    }
    return this.snapshot();
  }

  snapshot(): AgentPresenceNetworkFrame {
    const entries = [...this.agents.entries()];
    const agents = entries.map(([agentId, entry], index): CollectiveAgentFrame => {
      const frame = entry.engine.snapshot();
      return {
        agentId,
        label: entry.label,
        viewport: viewportFor(index, entries.length),
        frame,
        order: measureCollectiveOrder(frame.particles),
      };
    });
    const viewportById = new Map(agents.map((agent) => [agent.agentId, agent.viewport]));
    const handoffs = [...this.handoffs.values()].flatMap((handoff): CollectiveHandoffFrame[] => {
      const fromViewport = viewportById.get(handoff.from);
      const toViewport = viewportById.get(handoff.to);
      if (!fromViewport || !toViewport) return [];
      const start = viewportCenter(fromViewport);
      const end = viewportCenter(toViewport);
      const bend = {
        x: (start.x + end.x) / 2 + Math.cos(handoff.phase) * 0.08,
        y: (start.y + end.y) / 2 - 0.12 - Math.sin(handoff.phase) * 0.04,
      };
      const particles = Array.from({ length: 18 }, (_, index): HandoffParticle => {
        const offset = index / 18 * 0.52;
        const raw = handoff.status === "active" ? handoff.progress + offset : 1 - index / 18 * 0.16;
        const progress = Math.max(0, Math.min(1, raw));
        const inverse = 1 - progress;
        const x = inverse * inverse * start.x + 2 * inverse * progress * bend.x + progress * progress * end.x;
        const y = inverse * inverse * start.y + 2 * inverse * progress * bend.y + progress * progress * end.y;
        const scatter = handoff.status === "error" ? (index % 2 ? -1 : 1) * handoff.resolvedAge / 1400 * 0.05 : 0;
        return { x: x + scatter, y: y - Math.abs(scatter), phase: handoff.phase + index * 0.71 };
      });
      return [{ ...handoff, particles }];
    });
    return { time: this.time, sequence: this.sequence, agents, handoffs };
  }

  exportTape(): readonly PresenceEvidenceEntry[] {
    return structuredClone(this.tape);
  }

  static replay(seed: number, tape: readonly PresenceEvidenceEntry[], throughSequence = Number.POSITIVE_INFINITY) {
    const network = new AgentPresenceNetwork(seed);
    let previousTime = 0;
    for (const entry of tape) {
      if (entry.sequence > throughSequence) break;
      network.advanceTime(entry.at - previousTime);
      network.dispatch(entry.event, true);
      previousTime = entry.at;
    }
    return network;
  }
}
