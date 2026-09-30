import { Button, Modal, RiskLegend, RiskPip } from '@/design';
import { useMetrics } from '@/hooks/useData';
import { formatPercent } from '@/lib/format';
import { TEST_SET } from '@/lib/testSetCopy';
import { RISK_BAND_STYLES } from '@/theme/risk';
import { useUiStore } from '@/state/uiStore';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-b border-line pb-4 last:border-b-0 last:pb-0">
      <h3 className="eyebrow text-tertiary">{title}</h3>
      <div className="flex flex-col gap-1.5 text-body-s text-secondary">{children}</div>
    </section>
  );
}

/**
 * "Details ›" dialog behind the status line (DESIGN_SYSTEM §9): intended use, dataset and prevalence,
 * calibration and validation limits, what the colours mean, licences. Opened on demand only — there is
 * deliberately no blocking first-visit consent modal.
 */
export function DisclaimerModal() {
  const open = useUiStore((s) => s.detailsOpen);
  const close = useUiStore((s) => s.closeDetails);
  const metrics = useMetrics();
  const prevalence = metrics.data?.dataset.prevalence.CAD;
  const n = metrics.data?.dataset.n ?? 303;

  return (
    <Modal
      open={open}
      onClose={close}
      title="About these estimates"
      description="Read this before interpreting any number or colour in CardioTwin."
      footer={
        <Button variant="primary" onClick={close} data-autofocus>
          Understood
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Section title="Intended use">
          <p>
            CardioTwin is an <strong className="font-medium text-primary">educational and decision-support research</strong>{' '}
            prototype. It is <strong className="font-medium text-primary">not a diagnosis</strong> and not a substitute for
            invasive angiography, CT coronary angiography (CTCA) or any other formal diagnostic imaging, nor for clinical
            judgement.
          </p>
          <p>
            Risk is estimated per vessel (LAD, LCX, RCA). The model never localises a lesion inside a vessel, and clinical
            features are not anatomical coordinates. A regional wall-motion abnormality (RWMA) is an echocardiographic
            finding, not a lesion map.
          </p>
        </Section>
        <Section title="Data">
          <p>
            Trained on the <em>Extension of Z-Alizadeh Sani</em> dataset (UCI #411): {n} patients from a single centre who
            were referred for angiography. Coronary artery disease prevalence is{' '}
            {prevalence !== undefined ? formatPercent(prevalence) : 'about 71 %'}, far higher than in a screening
            population, so these probabilities do not transfer to general-population screening.
          </p>
        </Section>
        <Section title="Calibration and validation">
          <p>
            Probabilities are Platt-calibrated and thresholds were tuned on development folds, then frozen before the
            held-out test split was scored. {TEST_SET.rescore} The model has not been externally validated; performance on other
            populations, devices or sites is unknown.
          </p>
        </Section>
        <Section title="What the colours mean">
          <p>
            Only data is coloured. A vessel's colour is its predicted probability of significant stenosis, uniform from root
            to tip. Tinted myocardium shows the <em>approximate</em> supplied territory, not a perfusion scan. The left main
            is shown in grey because it is not predicted.
          </p>
          <RiskLegend className="py-1" />
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.values(RISK_BAND_STYLES).map((b, i) => (
              <li key={b.id} className="flex items-center gap-2">
                <RiskPip band={b.id} />
                <span className="text-primary">{b.label}</span>
                <span className="num text-tertiary">
                  {['< 25 %', '25–50 %', '50–75 %', '≥ 75 %'][i]}
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Licences">
          <p>
            Anatomy: BodyParts3D, © The Database Center for Life Science (DBCLS), licensed under CC BY-SA 2.1 Japan.
            Dataset: UCI Machine Learning Repository #411, CC BY 4.0. Code: MIT licence.
          </p>
        </Section>
      </div>
    </Modal>
  );
}
