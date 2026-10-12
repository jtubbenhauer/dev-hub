export const CODE_LENS_ENABLED_SETTING_KEY = "editor-code-lens-enabled";
export const MINIMAP_ENABLED_SETTING_KEY = "editor-minimap-enabled";

const BOOLEAN_EDITOR_SETTING_KEYS: readonly string[] = [
  CODE_LENS_ENABLED_SETTING_KEY,
  MINIMAP_ENABLED_SETTING_KEY,
];

export function isBooleanEditorSettingKey(key: string): boolean {
  return BOOLEAN_EDITOR_SETTING_KEYS.includes(key);
}
