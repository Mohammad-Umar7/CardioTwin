const PILLARS = [
  {
    n: '01',
    title: 'Predict',
    body: 'Calibrated logistic-regression + XGBoost ensemble, one head per target, tuned thresholds, held-out test split.',
  },
  {
    n: '02',
    title: 'Explain',
    body: 'Exact TreeSHAP per target, summed per clinical feature; additive in log-odds and reproducible in the browser.',
  },
  {
    n: '03',
    title: 'Map',
    body: 'Vessel colour = its probability; supplied territories tinted as an approximation, never a lesion location.',
  },
] as const;

/** 01 PREDICT · 02 EXPLAIN · 03 MAP (DESIGN_SYSTEM §4.1). */
export function Pillars() {
  return (
    <section aria-label="How it works" className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline md:grid-cols-3">
      {PILLARS.map((p) => (
        <article key={p.n} className="flex flex-col gap-1.5 bg-app px-5 py-4">
          <h2 className="flex items-baseline gap-3">
            <span className="mono text-mono-s text-accent">{p.n}</span>
            <span className="overline text-primary">{p.title}</span>
          </h2>
          <p className="text-body-s text-secondary">{p.body}</p>
        </article>
      ))}
    </section>
  );
}
