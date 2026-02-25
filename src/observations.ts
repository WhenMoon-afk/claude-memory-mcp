import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Observation {
  first_seen: string;
  last_seen: string;
  total_recalls: number;
  distinct_days: number;
  contexts: string[];
  promoted: boolean;
}

export interface PromotableResult {
  concept: string;
  score: number;
}

type ObservationMap = Record<string, Observation>;

export class ObservationStore {
  private data: ObservationMap;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.data = this.load();
  }

  record(concept: string, context: string): void {
    const now = new Date().toISOString().slice(0, 10);
    const existing = this.data[concept];

    if (existing) {
      existing.total_recalls++;
      if (existing.last_seen !== now) {
        existing.distinct_days++;
      }
      existing.last_seen = now;
      if (!existing.contexts.includes(context)) {
        existing.contexts.push(context);
      }
    } else {
      this.data[concept] = {
        first_seen: now,
        last_seen: now,
        total_recalls: 1,
        distinct_days: 1,
        contexts: [context],
        promoted: false,
      };
    }
  }

  get(concept: string): Observation | undefined {
    return this.data[concept];
  }

  all(): ObservationMap {
    return { ...this.data };
  }

  score(concept: string): number {
    const obs = this.data[concept];
    if (!obs) return 0;

    // sqrt dampens recall spam while still rewarding frequency
    const recallFactor = Math.sqrt(obs.total_recalls);
    const daysFactor = Math.log2(obs.distinct_days + 1);
    // Diversity bonus: more contexts = bonus, but never penalizes
    const diversityBonus =
      1 + 0.5 * Math.log2(Math.max(1, obs.contexts.length));

    // Recency weight: decay over 90 days
    const daysSinceLastSeen = Math.max(
      0,
      (Date.now() - new Date(obs.last_seen).getTime()) / (1000 * 60 * 60 * 24),
    );
    const recencyWeight = Math.max(0.1, 1 - daysSinceLastSeen / 90);

    return recallFactor * daysFactor * diversityBonus * recencyWeight;
  }

  getPromotable(threshold: number): PromotableResult[] {
    const results: PromotableResult[] = [];
    for (const [concept, obs] of Object.entries(this.data)) {
      if (obs.promoted) continue;
      const s = this.score(concept);
      if (s >= threshold) {
        results.push({ concept, score: s });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }

  markPromoted(concept: string): void {
    const obs = this.data[concept];
    if (obs) {
      obs.promoted = true;
    }
  }

  incrementDay(concept: string): void {
    const obs = this.data[concept];
    if (obs) {
      obs.distinct_days++;
    }
  }

  pruneStale(maxAgeDays: number = 30): number {
    const now = Date.now();
    const cutoff = maxAgeDays * 24 * 60 * 60 * 1000;
    let pruned = 0;

    for (const [concept, obs] of Object.entries(this.data)) {
      if (obs.promoted) continue;
      if (obs.total_recalls > 1) continue;
      const age = now - new Date(obs.last_seen).getTime();
      if (age > cutoff) {
        delete this.data[concept];
        pruned++;
      }
    }
    return pruned;
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  private load(): ObservationMap {
    try {
      const raw = readFileSync(this.path, "utf-8");
      return JSON.parse(raw) as ObservationMap;
    } catch {
      return {};
    }
  }
}
