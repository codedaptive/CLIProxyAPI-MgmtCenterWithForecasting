import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TOKEN_CATEGORIES, type ModelSpend } from './model';
import { TOKEN_RATES } from './rates';
import styles from './SpendPage.module.scss';

export function ModelSpendRows({
  model: m,
  hideApi = false,
  hidePlan = false,
  tokenCosts,
}: {
  model: ModelSpend;
  hideApi?: boolean;
  hidePlan?: boolean;
  tokenCosts?: { days30: number | null; hours24: number | null };
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const image = Boolean(TOKEN_RATES[m.model]?.image);
  const estimated = m.estimatedCacheWrite > 0;
  const money = (value: number, detailed = false) =>
    value.toLocaleString(i18n.language, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: detailed ? 4 : 2,
    });
  const number = (value: number) =>
    value.toLocaleString(i18n.language, { maximumFractionDigits: 0 });
  const percent = (value: number | null) =>
    value === null
      ? '—'
      : `${(value * 100).toLocaleString(i18n.language, { maximumFractionDigits: 1 })}%`;
  const labels = {
    input: estimated ? 'estimated_uncached_input' : 'uncached_input',
    output: image ? 'image_output' : 'output',
    cacheRead: 'cache_read',
    cacheWrite: estimated ? 'estimated_cache_write' : 'cache_write',
  };
  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className={styles.expandModel}
            aria-expanded={expanded}
            aria-controls={expanded ? id : undefined}
            aria-label={t('spend.expand_tokens', { model: m.model })}
            onClick={() => setExpanded(!expanded)}
          >
            <span aria-hidden="true">{expanded ? '⌄' : '›'}</span>
            <strong>{m.model}</strong>
          </button>
          {estimated && <small>{t('spend.estimated_cache_split')}</small>}
          {m.missing > 0 && (
            <small className={styles.warning}>{t('spend.unpriced', { count: m.missing })}</small>
          )}
        </td>
        <td>{number(m.tokens)}</td>
        {tokenCosts && (
          <>
            {!hideApi && (
              <td>
                {!m.missing && m.tokens > 0 ? money((m.api * 1_000_000) / m.tokens, true) : '—'}
              </td>
            )}
            {!hidePlan && (
              <>
                <td>{tokenCosts.days30 === null ? '—' : money(tokenCosts.days30, true)}</td>
                <td>{tokenCosts.hours24 === null ? '—' : money(tokenCosts.hours24, true)}</td>
              </>
            )}
          </>
        )}
        {!hideApi && (
          <td>
            {money(m.api)}
            {m.missing > 0 ? ' + ?' : ''}
          </td>
        )}
        {!hidePlan && (
          <>
            <td>
              <span>{percent(m.share)}</span>
              {m.share !== null && (
                <span className={styles.track}>
                  <span style={{ width: `${m.share * 100}%` }} />
                </span>
              )}
            </td>
            <td className={styles.emphasis}>{m.allocatedAccounts ? money(m.allocated) : '—'}</td>
          </>
        )}
      </tr>
      {expanded && (
        <tr className={styles.detailRow}>
          <td colSpan={2 + (tokenCosts ? 2 : 1) * (Number(!hideApi) + 2 * Number(!hidePlan))}>
            <div
              id={id}
              className={styles.tokenDetails}
              role="region"
              aria-label={t('spend.expand_tokens', { model: m.model })}
            >
              <p>{t('spend.token_detail_hint')}</p>
              {estimated && (
                <>
                  <p>
                    {t('spend.sol_write_estimate_hint', { count: number(m.estimatedCacheWrite) })}
                  </p>
                  <p>
                    {t('spend.sol_write_original', {
                      input: number(m.categories.input.tokens + m.estimatedCacheWrite),
                      writes: number(m.categories.cacheWrite.tokens - m.estimatedCacheWrite),
                    })}
                  </p>
                </>
              )}
              {estimated && !hideApi && <p>{t('spend.sol_write_estimate_cost')}</p>}
              {image && <p>{t('spend.image_input_estimate')}</p>}
              <table>
                <thead>
                  <tr>
                    {[
                      'token_category',
                      'tokens',
                      ...(!hideApi ? ['api_contribution', 'api_contribution_share'] : []),
                      ...(!hidePlan ? ['allocated'] : []),
                    ].map((k) => (
                      <th key={k}>{t(`spend.${k}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TOKEN_CATEGORIES.map((key) => {
                    const c = m.categories[key];
                    return (
                      <tr key={key}>
                        <td>{t(`spend.${labels[key]}`)}</td>
                        <td>{number(c.tokens)}</td>
                        {!hideApi && (
                          <>
                            <td>
                              {money(c.api, true)}
                              {c.missing ? ' + ?' : ''}
                            </td>
                            <td>{percent(!m.missing && m.api > 0 ? c.api / m.api : null)}</td>
                          </>
                        )}
                        {!hidePlan && (
                          <td>{m.allocatedAccounts ? money(c.allocated, true) : '—'}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {m.missing > 0 && <p className={styles.warning}>{t('spend.token_partial')}</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
