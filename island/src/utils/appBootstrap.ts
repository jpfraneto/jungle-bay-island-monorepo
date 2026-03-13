export type AppClientVariant = "mobile" | "desktop";

export interface AppBootstrap {
  client_variant: AppClientVariant;
  authenticated: boolean;
  session: {
    x_username: string;
    x_name: string;
    x_pfp: string;
  } | null;
}

declare global {
  interface Window {
    __JBI_BOOTSTRAP__?: AppBootstrap;
  }
}

export function getAppBootstrap(): AppBootstrap {
  return (
    window.__JBI_BOOTSTRAP__ ?? {
      client_variant: "desktop",
      authenticated: false,
      session: null,
    }
  );
}
