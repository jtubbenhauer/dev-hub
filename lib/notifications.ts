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

type NotificationNavigator = (href: string) => void;

let notificationNavigator: NotificationNavigator | null = null;

export function setNotificationNavigator(
  navigator: NotificationNavigator | null,
): void {
  notificationNavigator = navigator;
}

const MAX_OPEN_NOTIFICATIONS = 50;
const openNotificationsByTag = new Map<string, Notification>();

export interface BrowserNotificationContent {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly targetHref: string;
}

export function showBrowserNotification(
  content: BrowserNotificationContent,
): void {
  if (!cachedPushEnabled) return;
  if (typeof Notification === "undefined") return;
  if (document.hasFocus()) return;

  if (Notification.permission === "granted") {
    createNotification(content);
  } else if (Notification.permission !== "denied") {
    void Notification.requestPermission()
      .then((permission) => {
        if (permission === "granted") createNotification(content);
      })
      .catch(() => {});
  }
}

function forgetNotification(tag: string, notification: Notification): void {
  if (openNotificationsByTag.get(tag) === notification) {
    openNotificationsByTag.delete(tag);
  }
}

function createNotification(content: BrowserNotificationContent): void {
  const existingNotification = openNotificationsByTag.get(content.tag);
  if (existingNotification) {
    openNotificationsByTag.delete(content.tag);
    existingNotification.close();
  }

  const options: NotificationOptions & { renotify?: boolean } = {
    body: content.body,
    tag: content.tag,
    renotify: true,
    icon: "/favicon.ico",
  };
  let notification: Notification;
  try {
    notification = new Notification(content.title, options);
  } catch {
    // Android Chrome throws "Illegal constructor" outside service workers
    return;
  }

  openNotificationsByTag.set(content.tag, notification);
  if (openNotificationsByTag.size > MAX_OPEN_NOTIFICATIONS) {
    const oldestEntry = openNotificationsByTag.entries().next().value;
    if (oldestEntry) {
      const [oldestTag, oldestNotification] = oldestEntry;
      openNotificationsByTag.delete(oldestTag);
      oldestNotification.close();
    }
  }

  notification.onclick = () => {
    window.focus();
    notification.close();
    forgetNotification(content.tag, notification);
    navigateToNotificationTarget(content.targetHref);
  };
  notification.onclose = () => forgetNotification(content.tag, notification);
}

export function navigateToNotificationTarget(
  href: string,
  assignLocation: (target: string) => void = (target) =>
    window.location.assign(target),
): void {
  if (notificationNavigator) notificationNavigator(href);
  else assignLocation(href);
}

export function closeAllBrowserNotifications(): void {
  const trackedNotifications = [...openNotificationsByTag.values()];
  openNotificationsByTag.clear();
  for (const notification of trackedNotifications) notification.close();
}
