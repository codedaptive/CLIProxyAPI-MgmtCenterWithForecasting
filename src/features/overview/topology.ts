import type { Config } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import { openaiToResource, claudeToResource } from '@/features/providers/adapters';

/** Merge configured compatibility credentials with the OAuth-only credential snapshot.
 * Keep secrets out of the returned display model, including IDs and labels.
 */
export function overviewTopology(
  oauthFiles: AuthFileItem[],
  registeredModels: Record<string, string[]>,
  config: Config | null
) {
  const files = [...oauthFiles];
  const models = { ...registeredModels };
  const providerNames: Record<string, string> = {};
  (config?.openaiCompatibility ?? []).forEach((group, index) => {
    const resource = openaiToResource(group, index);
    const provider = `openai-compatible-${group.name.trim().toLowerCase()}`;
    providerNames[provider] = group.name;
    const prefix = group.prefix?.trim();
    const exposedModels = [
      ...new Set(
        (group.models ?? []).flatMap((model) => {
          const name = model.alias?.trim() || model.name.trim();
          if (!name) return [];
          if (!prefix) return [name];
          return !config?.forceModelPrefix || prefix === name
            ? [name, `${prefix}/${name}`]
            : [`${prefix}/${name}`];
        })
      ),
    ];
    // The proxy also supports a local compatible endpoint without an API key.
    const entries = group.apiKeyEntries.length ? group.apiKeyEntries : [{ apiKey: '' }];
    entries.forEach((key, keyIndex) => {
      const existing = oauthFiles.find(
        (file) =>
          (key.authIndex && String(file.authIndex) === key.authIndex) ||
          (file.type === provider &&
            file.account_type === 'api_key' &&
            key.apiKey &&
            file.account === key.apiKey &&
            file.base_url === group.baseUrl)
      );
      if (existing) return;
      const name = `config:openai:${group.sourceIndex ?? index}:${key.sourceIndex ?? keyIndex}`;
      files.push({
        name,
        type: provider,
        note:
          entries.length > 1 ? `${resource.name} #${keyIndex + 1}` : (resource.name ?? group.name),
        authIndex: key.authIndex,
        disabled: resource.disabled,
        overviewSource: 'configuration',
      });
      models[name] = exposedModels;
    });
  });
  thirdPartyClaudeKeys(config).forEach((key, index) => {
    const resource = claudeToResource(key, index);
    const label = resource.name || 'Anthropic compatible';
    // Keep the logical provider ID stable across an OpenAI -> Anthropic migration.
    const provider = `openai-compatible-${label.trim().toLowerCase()}`;
    providerNames[provider] = label;
    if (key.authIndex && oauthFiles.some((f) => String(f.authIndex) === key.authIndex)) return;
    const name = `config:claude:${key.source?.groupIndex ?? index}:${key.source?.keyIndex ?? 0}`;
    const siblings = thirdPartyClaudeKeys(config).filter(
      (k) => k.source?.groupIndex === key.source?.groupIndex
    );
    files.push({
      name,
      type: provider,
      note: siblings.length > 1 ? `${label} #${(key.source?.keyIndex ?? index) + 1}` : label,
      authIndex: key.authIndex,
      disabled: resource.disabled,
      overviewSource: 'configuration',
    });
    models[name] = [
      ...new Set(
        (key.models ?? []).flatMap((model) => {
          const id = model.alias?.trim() || model.name.trim();
          if (!id) return [];
          const excluded = (key.excludedModels ?? []).some((pattern) => {
            const regex =
              '^' +
              pattern
                .split('*')
                .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('.*') +
              '$';
            return new RegExp(regex, 'i').test(id);
          });
          if (excluded && !resource.disabled) return [];
          const prefix = key.prefix?.trim();
          if (!prefix) return [id];
          return !config?.forceModelPrefix || prefix === id
            ? [id, `${prefix}/${id}`]
            : [`${prefix}/${id}`];
        })
      ),
    ];
  });
  return { files, models, providerNames };
}

function thirdPartyClaudeKeys(config: Config | null) {
  return (config?.claudeApiKeys ?? []).filter((key) => {
    if (!key.baseUrl) return false;
    try {
      return new URL(key.baseUrl).hostname !== 'api.anthropic.com';
    } catch {
      return false;
    }
  });
}

/** The API-key counters use the configured name; inference uses the prefixed ID. */
export function overviewUsage(
  usage: import('@/utils/recentRequests').ApiKeyUsageResponse,
  config: Config | null
) {
  const names = new Set([
    ...(config?.openaiCompatibility ?? []).map((g) => g.name.trim().toLowerCase()),
    ...thirdPartyClaudeKeys(config).map((k) =>
      String(k.source?.group.name || 'Anthropic compatible')
        .trim()
        .toLowerCase()
    ),
  ]);
  const result: typeof usage = {};
  Object.entries(usage).forEach(([id, entries]) => {
    const provider = names.has(id.toLowerCase()) ? `openai-compatible-${id.toLowerCase()}` : id;
    Object.entries(entries).forEach(([entryKey, entry]) => {
      const native =
        id === 'claude'
          ? thirdPartyClaudeKeys(config).find((key) => entryKey === `${key.baseUrl}|${key.apiKey}`)
          : undefined;
      const target = native
        ? `openai-compatible-${String(native.source?.group.name || 'Anthropic compatible')
            .trim()
            .toLowerCase()}`
        : provider;
      result[target] = { ...result[target], [entryKey]: entry };
    });
  });
  return result;
}
