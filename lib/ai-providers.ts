export type ProviderId = "anthropic" | "openai" | "google";

export type ProviderCatalogItem = {
  id: ProviderId;
  name: string;
  envKey: string;
  modelEnvKey: string;
};

export const AI_PROVIDERS: ProviderCatalogItem[] = [
  {
    id: "anthropic",
    name: "Anthropic Claude",
    envKey: "ANTHROPIC_API_KEY",
    modelEnvKey: "ANTHROPIC_MODEL",
  },
  {
    id: "openai",
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    modelEnvKey: "OPENAI_MODEL",
  },
  {
    id: "google",
    name: "Google Gemini",
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    modelEnvKey: "GOOGLE_MODEL",
  },
];

export const DEFAULT_PROVIDER_ID: ProviderId = "anthropic";

export function getConfiguredProviders() {
  return AI_PROVIDERS.filter((provider) => Boolean(process.env[provider.envKey]));
}

export function getDefaultProviderId() {
  return getConfiguredProviders()[0]?.id ?? DEFAULT_PROVIDER_ID;
}

export function resolveProviderId(providerId: string | undefined) {
  const requested = AI_PROVIDERS.find((provider) => provider.id === providerId);

  if (requested && process.env[requested.envKey]) {
    return requested.id;
  }

  return getDefaultProviderId();
}

export function getProviderCatalogItem(providerId: string | undefined) {
  return (
    AI_PROVIDERS.find((provider) => provider.id === providerId) ??
    AI_PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER_ID)!
  );
}

export function resolveModelId(providerId: string | undefined) {
  const provider = getProviderCatalogItem(providerId);
  const envModel = process.env[provider.modelEnvKey]?.trim();

  if (envModel) {
    return envModel;
  }

  throw new Error(`请在环境变量中配置 ${provider.modelEnvKey}。`);
}