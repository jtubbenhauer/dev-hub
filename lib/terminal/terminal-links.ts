export function isLinkActivationClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function openTerminalLink(event: MouseEvent, uri: string): void {
  if (!isLinkActivationClick(event)) return;
  event.preventDefault();
  window.open(uri, "_blank", "noopener,noreferrer");
}
