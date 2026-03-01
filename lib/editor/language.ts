import type { Extension } from "@codemirror/state"
import { javascript } from "@codemirror/lang-javascript"
import { html } from "@codemirror/lang-html"
import { css } from "@codemirror/lang-css"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { rust } from "@codemirror/lang-rust"
import { go } from "@codemirror/lang-go"
import { yaml } from "@codemirror/lang-yaml"

export function getLanguageExtension(language: string): Extension | null {
  switch (language) {
    case "typescript":
      return javascript({ typescript: true, jsx: true })
    case "javascript":
      return javascript({ jsx: true })
    case "html":
      return html()
    case "css":
      return css()
    case "json":
      return json()
    case "markdown":
      return markdown()
    case "python":
      return python()
    case "rust":
      return rust()
    case "go":
      return go()
    case "yaml":
      return yaml()
    default:
      return null
  }
}
