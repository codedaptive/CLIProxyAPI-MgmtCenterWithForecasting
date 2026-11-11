import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useAuthStore, useConfigStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { clientCommand, clientEndpoints, type HomeClient, type ClientShell } from '../clientSetup';
import styles from './HomeSetup.module.scss';

interface HomeSetupProps {
  connected: boolean;
  credentialCount: number | null;
  providerKeyCount: number | null;
  modelCount: number | null;
}

export function HomeSetup({
  connected,
  credentialCount,
  providerKeyCount,
  modelCount,
}: HomeSetupProps) {
  const { t } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);
  const clientKey = useConfigStore((state) => state.config?.apiKeys?.[0]);
  const [client, setClient] = useState<HomeClient>('claude');
  const [shell, setShell] = useState<ClientShell>('posix');
  const [copyResult, setCopyResult] = useState('');
  const endpoints = clientEndpoints(apiBase);
  const command = clientCommand(client, apiBase, shell);
  const accountsKnown = credentialCount !== null && providerKeyCount !== null;
  const hasAccounts = (credentialCount ?? 0) + (providerKeyCount ?? 0) > 0;

  async function copy(value: string) {
    setCopyResult(
      (await copyToClipboard(value)) ? t('home_setup.copied') : t('home_setup.copy_failed')
    );
  }

  return (
    <section className={styles.home} aria-labelledby="home-setup-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t('home_setup.eyebrow')}</p>
          <h1 id="home-setup-title">{t('home_setup.title')}</h1>
          <p className={styles.subtitle}>{t('home_setup.subtitle')}</p>
        </div>
        <span className={styles.badge} data-connected={connected}>
          <span aria-hidden="true">●</span>{' '}
          {t(connected ? 'home_setup.online' : 'home_setup.offline')}
        </span>
      </header>

      <div className={styles.grid}>
        <div className={styles.connection}>
          <span className={styles.label}>{t('home_setup.address')}</span>
          <code className={styles.address}>{endpoints?.root || '—'}</code>
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="secondary"
              disabled={!endpoints}
              onClick={() => void copy(endpoints!.root)}
            >
              {t('home_setup.copy_address')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!connected || !clientKey}
              onClick={() => void copy(clientKey!)}
            >
              {t('home_setup.copy_key')}
            </Button>
          </div>
          <p className={styles.note}>{t('home_setup.key_note')}</p>
          {endpoints?.localOnly && <p className={styles.warning}>{t('home_setup.local_note')}</p>}
          <ol className={styles.steps}>
            <li>
              <span className={styles.number}>01</span>
              <div>
                <strong>{t('home_setup.accounts')}</strong>
                <p>
                  {t(
                    !accountsKnown
                      ? 'home_setup.checking'
                      : hasAccounts
                        ? 'home_setup.accounts_present'
                        : 'home_setup.accounts_missing'
                  )}
                </p>
                <Link to="/oauth">{t('home_setup.sign_in')} →</Link>
                <Link to="/ai-providers">{t('home_setup.provider_keys')} →</Link>
              </div>
            </li>
            <li>
              <span className={styles.number}>02</span>
              <div>
                <strong>{t('home_setup.models')}</strong>
                <p>
                  {modelCount === null
                    ? t('home_setup.checking')
                    : t('home_setup.model_count', { count: modelCount })}
                </p>
                <Link to="/system">{t('home_setup.view_models')} →</Link>
              </div>
            </li>
            <li>
              <span className={styles.number}>03</span>
              <div>
                <strong>{t('home_setup.health')}</strong>
                <p>{t('home_setup.health_note')}</p>
                <Link to="/quota">{t('home_setup.quotas')} →</Link>
                <Link to="/logs">{t('home_setup.logs')} →</Link>
              </div>
            </li>
          </ol>
        </div>

        <div className={styles.client}>
          <h2>{t('home_setup.connect')}</h2>
          <div className={styles.tabs} aria-label={t('home_setup.client_choice')}>
            {(['claude', 'codex', 'codex-desktop'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={client === value}
                onClick={() => {
                  setClient(value);
                  setCopyResult('');
                }}
              >
                {value === 'claude'
                  ? 'Claude Code'
                  : value === 'codex'
                    ? 'Codex CLI'
                    : 'Codex desktop'}
              </button>
            ))}
          </div>
          {client !== 'codex-desktop' && (
            <label className={styles.shellPicker}>
              {t('home_setup.shell')}
              <select
                aria-label={t('home_setup.shell')}
                value={shell}
                onChange={(event) => {
                  setShell(event.target.value as ClientShell);
                  setCopyResult('');
                }}
              >
                <option value="posix">{t('home_setup.shell_posix')}</option>
                <option value="powershell">{t('home_setup.shell_powershell')}</option>
              </select>
            </label>
          )}
          <p className={styles.note}>
            {t(
              client === 'codex-desktop'
                ? 'home_setup.desktop_instructions'
                : 'home_setup.instructions'
            )}
          </p>
          <pre className={styles.code}>
            <code>{command || '—'}</code>
          </pre>
          <div className={styles.actions}>
            <Button size="sm" disabled={!command} onClick={() => void copy(command)}>
              {t('home_setup.copy_command')}
            </Button>
            <Link to="/config">{t('home_setup.manage_keys')}</Link>
          </div>
          <p className={styles.note}>
            {t(client === 'codex-desktop' ? 'home_setup.desktop_note' : 'home_setup.session_note')}
          </p>
          <p className={styles.feedback} role="status" aria-live="polite">
            {copyResult}
          </p>
        </div>
      </div>
    </section>
  );
}
