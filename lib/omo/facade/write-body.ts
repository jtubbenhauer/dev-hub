import {
  isOmoPermissionPreset,
  type OmoPermissionPreset,
} from "@/lib/omo/permission-presets";
import { isJsonObject } from "@/lib/omo/session-registry-records";

export type OmoPromptImage = {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
};

export type OmoRequestedModel = {
  readonly providerID: string;
  readonly modelID: string;
};

export type OmoPromptBody = {
  readonly message: string;
  readonly images: readonly OmoPromptImage[];
  readonly model?: OmoRequestedModel;
  readonly agent?: string;
  readonly variant?: string;
  readonly permissionPreset?: OmoPermissionPreset;
};

export type OmoBodyResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: "invalid_request" | "unsupported_attachment";
    };

function optionalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function requestedModel(value: unknown): OmoRequestedModel | undefined {
  if (!isJsonObject(value)) return undefined;
  const providerID = value["providerID"];
  const modelID = value["modelID"];
  return typeof providerID === "string" && typeof modelID === "string"
    ? { providerID, modelID }
    : undefined;
}

function imageFromPart(
  part: Readonly<Record<string, unknown>>,
): OmoPromptImage | null {
  const mime = part["mime"];
  const url = part["url"];
  if (
    typeof mime !== "string" ||
    !mime.startsWith("image/") ||
    typeof url !== "string" ||
    !url.startsWith("data:")
  ) {
    return null;
  }
  const separator = url.indexOf(",");
  if (separator < 0 || !url.slice(5, separator).endsWith(";base64")) {
    return null;
  }
  return {
    type: "image",
    data: url.slice(separator + 1),
    mimeType: mime,
  };
}

export function parsePromptBody(value: unknown): OmoBodyResult<OmoPromptBody> {
  if (!isJsonObject(value) || !Array.isArray(value["parts"])) {
    return { ok: false, error: "invalid_request" };
  }
  const texts: string[] = [];
  const images: OmoPromptImage[] = [];
  for (const part of value["parts"]) {
    if (!isJsonObject(part)) return { ok: false, error: "invalid_request" };
    if (part["type"] === "text" && typeof part["text"] === "string") {
      texts.push(part["text"]);
      continue;
    }
    if (part["type"] === "file") {
      const image = imageFromPart(part);
      if (image === null) {
        return { ok: false, error: "unsupported_attachment" };
      }
      images.push(image);
      continue;
    }
    return { ok: false, error: "invalid_request" };
  }
  const modelValue = value["model"];
  const model =
    modelValue === undefined ? undefined : requestedModel(modelValue);
  if (modelValue !== undefined && model === undefined) {
    return { ok: false, error: "invalid_request" };
  }
  const agent = optionalString(value, "agent");
  const variant = optionalString(value, "variant");
  const permissionPreset = permissionPresetField(value, "permissionPreset");
  if (permissionPreset === null) return { ok: false, error: "invalid_request" };
  return {
    ok: true,
    value: {
      message: texts.join(""),
      images,
      ...(model === undefined ? {} : { model }),
      ...(agent === undefined ? {} : { agent }),
      ...(variant === undefined ? {} : { variant }),
      ...(permissionPreset === undefined ? {} : { permissionPreset }),
    },
  };
}

// undefined when the field is absent, null when it isn't a known preset.
export function permissionPresetField(
  value: unknown,
  key: string,
): OmoPermissionPreset | null | undefined {
  if (!isJsonObject(value) || value[key] === undefined) return undefined;
  const field = value[key];
  return isOmoPermissionPreset(field) ? field : null;
}

export function requiredString(value: unknown, key: string): string | null {
  if (!isJsonObject(value)) return null;
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

export function optionalArguments(value: unknown): string | null | undefined {
  if (!isJsonObject(value)) return undefined;
  const field = value["arguments"];
  if (field === undefined || field === null || field === "") return null;
  return typeof field === "string" ? field : undefined;
}

export function questionAnswers(
  value: unknown,
): readonly (readonly string[])[] | null {
  if (!isJsonObject(value) || !Array.isArray(value["answers"])) return null;
  const answers: string[][] = [];
  for (const answer of value["answers"]) {
    if (
      !Array.isArray(answer) ||
      answer.some((item) => typeof item !== "string")
    ) {
      return null;
    }
    answers.push(answer);
  }
  return answers;
}
