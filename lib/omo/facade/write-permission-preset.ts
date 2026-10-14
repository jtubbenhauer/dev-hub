import { attachOmoWriteSession } from "@/lib/omo/facade/write-access";
import { permissionPresetField } from "@/lib/omo/facade/write-body";
import type { OmoWriteContext } from "@/lib/omo/facade/write-types";
import {
  invalidRequestResponse,
  noContentResponse,
} from "@/lib/omo/facade/write-types";
import {
  OMO_PERMISSION_PRESET_CAPABILITIES,
  OMO_PERMISSION_PRESET_DETAILS,
  type OmoPermissionPreset,
} from "@/lib/omo/permission-presets";
import type { OmoSessionBinding } from "@/lib/omo/session-registry";
import {
  OmoEngineUnavailableError,
  OmoPermissionPresetUnsupportedError,
} from "@/lib/omo/session-registry-errors";

// An open_session that attaches with another permissionPreset moves the live
// session to it. omo only streams a session to connections attached to it, and
// releasing an attachment hides the session from that connection, so the
// change goes through a short-lived second connection instead of dev-hub's own.
export async function ensureOmoPermissionPreset(
  context: OmoWriteContext,
  binding: OmoSessionBinding,
  preset: OmoPermissionPreset,
): Promise<void> {
  if (binding.permissionPreset === preset) return;
  const capability = OMO_PERMISSION_PRESET_CAPABILITIES[preset];
  if (capability !== undefined) {
    const protocolInfo = await context.runtime.client.connect();
    if (!protocolInfo.capabilities.includes(capability)) {
      throw new OmoPermissionPresetUnsupportedError(
        OMO_PERMISSION_PRESET_DETAILS[preset].label,
      );
    }
  }
  const createSideClient = context.runtime.createSideClient;
  if (createSideClient === undefined || binding.sessionPath === null) {
    throw new OmoEngineUnavailableError(
      "open_session",
      "the session can't change permission mode yet",
    );
  }
  const sideClient = createSideClient();
  try {
    await sideClient.connect();
    const opened = await sideClient.openSession(
      {
        sessionPath: binding.sessionPath,
        cwd: binding.workspace.path,
        permissionPreset: preset,
        retain_on_disconnect: true,
        kind: "interactive",
      },
      () => undefined,
    );
    await sideClient.request({
      type: "close_session",
      sessionId: opened.sessionId,
    });
    if (opened["attached"] !== true) {
      context.runtime.registry.detachBinding(binding);
      throw new OmoEngineUnavailableError(
        "open_session",
        "the session was no longer open in omo",
      );
    }
  } finally {
    sideClient.close();
  }
  binding.permissionPreset = preset;
}

export async function setOmoPermissionPreset(
  context: OmoWriteContext,
  rawId: string,
  body: unknown,
): Promise<Response> {
  const preset = permissionPresetField(body, "preset");
  if (preset === undefined || preset === null) return invalidRequestResponse();
  const binding = await attachOmoWriteSession(context, rawId);
  await ensureOmoPermissionPreset(context, binding, preset);
  return noContentResponse();
}
