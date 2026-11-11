import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { SubscriptionTerms } from './types';
import { providerPlans, selectedContract, validTax, type PlanCatalog } from './prices';
import styles from './PlansPage.module.scss';

export function PlanSelection({
  terms,
  provider,
  catalog,
  taxRate,
  label,
  disabled,
  save,
}: {
  terms: SubscriptionTerms;
  provider: string;
  catalog: PlanCatalog | null;
  taxRate: number;
  label: string;
  disabled: boolean;
  save: (amount: number | null, terms: SubscriptionTerms) => Promise<boolean>;
}) {
  const { t, i18n } = useTranslation();
  const [selection, setSelection] = useState<string | null>(null);
  const [renewalDate, setRenewalDate] = useState(terms.renewalDate ?? '');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const plans = providerPlans(catalog, provider);
  const selected =
    selection ??
    plans.find((p) =>
      terms.planId
        ? p.id === terms.planId
        : p.name === terms.planType && p.cadence === terms.cadence
    )?.id ??
    '';
  const plan = plans.find((p) => p.id === selected);
  const money = (n: number | null) =>
    n === null ? '—' : n.toLocaleString(i18n.language, { style: 'currency', currency: 'USD' });
  return (
    <form
      className={styles.planForm}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!plan || !validTax(taxRate)) return;
        setBusy(true);
        setFailed(false);
        const contract = selectedContract(plan, taxRate, renewalDate);
        try {
          setFailed(!(await save(contract.amount, contract.terms)));
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className={styles.planSelect}>
        {t('planning.published_plan')}
        <select
          value={selected}
          disabled={disabled || busy}
          aria-label={t('planning.type_for', { account: label })}
          onChange={(e) => setSelection(e.target.value)}
        >
          <option value="" disabled>
            {t('planning.choose_published_plan')}
          </option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {t(`planning.${p.cadence}`)} · {money(p.amount)}{' '}
              {t('planning.monthly_equivalent')}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.renewal}>
        {t('planning.renewal')}
        <input
          type="date"
          value={renewalDate}
          disabled={disabled || busy}
          aria-label={t('planning.renewal_for', { account: label })}
          onChange={(e) => setRenewalDate(e.target.value)}
        />
      </label>
      <Button
        className={styles.save}
        type="submit"
        variant="secondary"
        disabled={disabled || busy || !plan || !validTax(taxRate)}
      >
        {t('spend.save')}
      </Button>
      {plan && (
        <span className={styles.price}>
          {t('planning.selected_price', {
            amount: validTax(taxRate)
              ? money(selectedContract(plan, taxRate, renewalDate).amount)
              : '—',
          })}
        </span>
      )}
      {!plans.length && (
        <span className={styles.message}>{t('planning.no_published_options')}</span>
      )}
      {failed && (
        <span className={styles.message} role="alert">
          {t('spend.save_failed')}
        </span>
      )}
    </form>
  );
}
