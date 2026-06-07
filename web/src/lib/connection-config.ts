const STORAGE_KEY = "hermes-dashboard-config";

export interface DashboardConfig {
  url: string;
  token: string;
}

export function getDashboardConfig(): DashboardConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DashboardConfig;
  } catch {
    return null;
  }
}

export function setDashboardConfig(url: string, token: string): void {
  const normalizedUrl = url.replace(/\/+$/, "");
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ url: normalizedUrl, token }),
  );
}

export function clearDashboardConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}
