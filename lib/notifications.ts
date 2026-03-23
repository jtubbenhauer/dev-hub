// Browser push notification utility — pure functions, no React imports

let cachedPushEnabled = true;

export function updatePushNotificationEnabled(enabled: boolean): void {
  cachedPushEnabled = enabled;
}

export function getPushNotificationEnabled(): boolean {
  return cachedPushEnabled;
}

export function sendBrowserNotification(
  title: string,
  options?: NotificationOptions,
): void {
  if (!cachedPushEnabled) return;
  if (typeof Notification === "undefined") return;
  if (document.hasFocus()) return;

  if (Notification.permission === "granted") {
    new Notification(title, options);
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        new Notification(title, options);
      }
    });
  }
}
