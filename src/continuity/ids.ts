import type { ArtifactType } from "./types.js";

const PREFIX: Record<ArtifactType, string> = {
  snapshot: "snap",
  decision: "dec",
  project_state: "state",
  bundle: "bun",
  meta_snapshot: "meta",
};

export function makeArtifactId(type: ArtifactType, seq: number): string {
  return `${PREFIX[type]}-${seq}`;
}
