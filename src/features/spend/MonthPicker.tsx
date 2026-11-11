import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentMonth } from './model';
import styles from './SpendPage.module.scss';

export function MonthPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const ref = useRef<HTMLDetailsElement>(null);
  const maximum = currentMonth();
  return (
    <details
      className={styles.monthPicker}
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && ref.current) {
          ref.current.open = false;
          ref.current.querySelector('summary')?.focus();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget) && ref.current) ref.current.open = false;
      }}
    >
      <summary aria-label={t('spend.month')} onClick={() => setYear(Number(value.slice(0, 4)))}>
        {new Date(Number(value.slice(0, 4)), Number(value.slice(5)) - 1, 1).toLocaleDateString(
          i18n.language,
          { month: 'long', year: 'numeric' }
        )}{' '}
        ▾
      </summary>
      <div className={styles.monthPopup} role="group" aria-label={t('spend.month')}>
        <div className={styles.monthYear}>
          <button
            type="button"
            aria-label={t('spend.previous_year')}
            onClick={() => setYear(year - 1)}
          >
            ‹
          </button>
          <strong aria-live="polite">{year}</strong>
          <button
            type="button"
            aria-label={t('spend.next_year')}
            disabled={year >= Number(maximum.slice(0, 4))}
            onClick={() => setYear(year + 1)}
          >
            ›
          </button>
        </div>
        <div className={styles.monthGrid}>
          {Array.from({ length: 12 }, (_, i) => {
            const month = `${year}-${String(i + 1).padStart(2, '0')}`;
            return (
              <button
                type="button"
                key={month}
                disabled={month > maximum}
                aria-pressed={value === month}
                onClick={() => {
                  onChange(month);
                  if (ref.current) {
                    ref.current.open = false;
                    ref.current.querySelector('summary')?.focus();
                  }
                }}
              >
                {new Date(year, i, 1).toLocaleDateString(i18n.language, { month: 'short' })}
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}
