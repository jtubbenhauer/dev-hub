import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags } from "@lezer/highlight"
import type { Extension } from "@codemirror/state"
import { githubDark } from "@fsegurai/codemirror-theme-github-dark"
import {
  catppuccinMocha,
  catppuccinMacchiato,
  catppuccinFrappe,
  catppuccinLatte,
} from "@catppuccin/codemirror"
import { dracula } from "@uiw/codemirror-theme-dracula"

const defaultLightEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#ffffff",
      color: "#24292e",
    },
    ".cm-content": {
      caretColor: "#24292e",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#24292e",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "#c8c8fa",
      },
    ".cm-panels": {
      backgroundColor: "#f6f8fa",
      color: "#24292e",
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid #d0d7de",
    },
    ".cm-panels.cm-panels-bottom": {
      borderTop: "1px solid #d0d7de",
    },
    ".cm-searchMatch": {
      backgroundColor: "#ffdf5d66",
      outline: "1px solid #ffdf5d",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "#ffdf5d",
    },
    ".cm-activeLine": {
      backgroundColor: "#f6f8fa",
    },
    ".cm-selectionMatch": {
      backgroundColor: "#c8c8fa44",
    },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: "#c8c8fa",
      outline: "1px solid #c8c8facc",
    },
    ".cm-gutters": {
      backgroundColor: "#f6f8fa",
      color: "#8b949e",
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#eaeef2",
      color: "#24292e",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: "none",
      color: "#6e7781",
    },
    ".cm-tooltip": {
      border: "1px solid #d0d7de",
      backgroundColor: "#f6f8fa",
    },
    ".cm-tooltip .cm-tooltip-arrow:before": {
      borderTopColor: "transparent",
      borderBottomColor: "transparent",
    },
    ".cm-tooltip .cm-tooltip-arrow:after": {
      borderTopColor: "#f6f8fa",
      borderBottomColor: "#f6f8fa",
    },
    ".cm-tooltip-autocomplete": {
      "& > ul > li[aria-selected]": {
        backgroundColor: "#c8c8fa",
        color: "#24292e",
      },
    },
  },
  { dark: false }
)

const defaultLightHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#cf222e" },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: "#24292e" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#8250df" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: "#0550ae" },
  { tag: [tags.definition(tags.name), tags.separator], color: "#24292e" },
  { tag: [tags.brace], color: "#24292e" },
  { tag: [tags.annotation], color: "#6e7781" },
  { tag: [tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: "#0550ae" },
  { tag: [tags.typeName, tags.className], color: "#953800" },
  { tag: [tags.operator, tags.operatorKeyword], color: "#cf222e" },
  { tag: [tags.tagName], color: "#116329" },
  { tag: [tags.squareBracket], color: "#24292e" },
  { tag: [tags.angleBracket], color: "#24292e" },
  { tag: [tags.attributeName], color: "#0550ae" },
  { tag: [tags.regexp], color: "#0550ae" },
  { tag: [tags.quote], color: "#116329" },
  { tag: [tags.string], color: "#0a3069" },
  { tag: tags.link, color: "#0550ae", textDecoration: "underline" },
  { tag: [tags.url, tags.escape, tags.special(tags.string)], color: "#0550ae" },
  { tag: [tags.meta], color: "#6e7781" },
  { tag: [tags.comment], color: "#6e7781", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold", color: "#24292e" },
  { tag: tags.emphasis, fontStyle: "italic", color: "#24292e" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.heading, fontWeight: "bold", color: "#0550ae" },
  { tag: tags.special(tags.heading1), fontWeight: "bold", color: "#0550ae" },
  { tag: tags.heading1, fontWeight: "bold", color: "#0550ae" },
  { tag: [tags.heading2, tags.heading3, tags.heading4], fontWeight: "bold", color: "#0550ae" },
  { tag: [tags.heading5, tags.heading6], color: "#0550ae" },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: "#0550ae" },
  { tag: [tags.processingInstruction, tags.inserted], color: "#116329" },
  { tag: [tags.contentSeparator], color: "#cf222e" },
  { tag: tags.invalid, color: "#82071e", borderBottom: "1px dotted #cf222e" },
])

const defaultLight: Extension = [
  defaultLightEditorTheme,
  syntaxHighlighting(defaultLightHighlightStyle),
]

export function getCM6Theme(theme: string): Extension {
  switch (theme) {
    case "catppuccin-mocha":
      return catppuccinMocha
    case "catppuccin-macchiato":
      return catppuccinMacchiato
    case "catppuccin-frappe":
      return catppuccinFrappe
    case "catppuccin-latte":
      return catppuccinLatte
    case "dracula":
      return dracula
    case "github-dark":
      return githubDark
    case "default-light":
      return defaultLight
    case "default-dark":
    default:
      return githubDark
  }
}
