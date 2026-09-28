import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoSessionRegistry } from "@/lib/omo/session-registry-core";
import type { OmoSessionBinding } from "@/lib/omo/session-registry-types";

export function receiveOmoBoundRecord(
  registry: OmoSessionRegistry,
  binding: OmoSessionBinding,
  record: JsonlRecord,
): void {
  if (record["type"] === "session_replaced") {
    registry.dispatchBoundRecord(binding, record);
    return;
  }
  if (binding.state === "live") {
    registry.dispatchBoundRecord(binding, record);
    return;
  }
  if (
    binding.state === "hydrating" ||
    binding.state === "cutover" ||
    binding.state === "replaced"
  ) {
    binding.buffer.push(record);
  }
}
