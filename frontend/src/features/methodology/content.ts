/**
 * Pure derivations behind the Methodology page (WORKSTATION_V2 §6.4 "Methodology"): the pipeline
 * steps, the dataset card, the modality mix, the leakage policy, the per-target model table, the
 * anatomy pipeline and the reference list.
 *
 * Every number is read from the artifacts the model ships with (metrics.json, schema.json,
 * manifest.json), so the page can never drift from the deployed model. Every name goes through
 * `lib/modelNames` (the same map as Performance), so no raw dataset key or internal model id is
 * ever rendered. All functions are total: a missing artifact yields shorter copy, never a throw.
 */
import { formatMetricValue, formatPercent } from '@/lib/format';
import { deployedModelName, deployedModelShort, featureName, modalityName, MODALITY_ORDER } from '@/lib/modelNames';
import {
  TARGET_ORDER,
  type AnatomyManifest,
  type FeatureSchema,
  type FeatureSpec,
  type KnownTargetId,
  type MetricsReport,
} from '@/types/contracts';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const f2 = (v: number | null | undefined) => formatMetricValue(v);

/** Superscript digits for "10⁻⁶"-style exponents. */
const SUPER: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export function powerOfTen(exp: number): string {
  return `10${String(exp)
    .split('')
    .map((c) => SUPER[c] ?? c)
    .join('')}`;
}

/** The smallest power of ten strictly above `v` ("< 10⁻¹⁴" for 1.8e-15). */
export function boundAbove(v: number): string {
  if (!(v > 0)) return powerOfTen(-15);
  return powerOfTen(Math.floor(Math.log10(v)) + 1);
}

// ------------------------------------------------------------------------------------ key facts

export interface KeyFacts {
  n: number | null;
  nDev: number | null;
  nTest: number | null;
  nInputs: number | null;
  nModalities: number | null;
  nTargets: number;
  seed: number | null;
  cvSplits: number | null;
  cvRepeats: number | null;
  nBootstrap: number | null;
  nResplits: number | null;
  modelVersion: string | null;
  /** Worst ensemble SHAP additivity error across targets (log-odds). */
  additivity: number | null;
}

export function keyFacts(report?: MetricsReport | null, schema?: FeatureSchema | null): KeyFacts {
  const p = (report?.protocol ?? {}) as Rec;
  const checks = (report as unknown as Rec | undefined)?.explainability_checks;
  let additivity: number | null = null;
  if (isRec(checks)) {
    for (const t of Object.values(checks)) {
      const e = isRec(t) ? num(t.ensemble_additivity_max_error) : null;
      if (e !== null) additivity = Math.max(additivity ?? 0, e);
    }
  }
  const robustness = (report as unknown as Rec | undefined)?.robustness;
  let nResplits: number | null = null;
  if (isRec(robustness)) {
    for (const t of Object.values(robustness)) if (isRec(t) && num(t.n_splits) !== null) nResplits = num(t.n_splits);
  }
  const groups = schema ? new Set(schema.features.map((f) => f.group)) : null;
  return {
    n: report?.dataset.n ?? null,
    nDev: report?.dataset.n_dev ?? null,
    nTest: report?.dataset.n_test ?? null,
    nInputs: schema?.features.length ?? num((report?.dataset as Rec | undefined)?.n_features_used),
    nModalities: groups ? groups.size : null,
    nTargets: schema?.targets.length ?? TARGET_ORDER.length,
    seed: num(p.seed),
    cvSplits: num(p.cv_splits),
    cvRepeats: num(p.cv_repeats),
    nBootstrap: num(p.n_bootstrap),
    nResplits,
    modelVersion: str((report as unknown as Rec | undefined)?.model_version) ?? schema?.model_version ?? report?.version ?? null,
    additivity,
  };
}

// ------------------------------------------------------------------------------ pipeline steps

export interface PipelineStep {
  n: number;
  title: string;
  detail: string;
  /** Section of this page that explains the step. */
  anchor: string;
}

export interface PipelinePhase {
  id: string;
  label: string;
  /** Short qualifier under the phase name ("development set only"). */
  note?: string;
  steps: PipelineStep[];
}

type PhaseDraft = Omit<PipelinePhase, 'steps'> & { steps: Omit<PipelineStep, 'n'>[] };

/** The end-to-end pipeline, data → 3D, as five phases of numbered steps (11 in all). */
export function pipelinePhases(k: KeyFacts): PipelinePhase[] {
  const count = (v: number | null, noun: string) => (v === null ? noun : `${v} ${noun}`);
  const folds =
    k.cvSplits !== null && k.cvRepeats !== null ? `${k.cvSplits}-fold × ${k.cvRepeats} outside, tuning inside` : 'repeated folds outside, tuning inside';
  const phases: PhaseDraft[] = [
    {
      id: 'data',
      label: 'Data',
      steps: [
        {
          title: 'Clinical record',
          detail: [count(k.n, 'patients'), count(k.nInputs, 'inputs'), count(k.nModalities, 'modalities')].join(' · '),
          anchor: 'data',
        },
        { title: 'Leakage guard', detail: 'Angiography results never enter the inputs', anchor: 'leakage' },
        {
          title: 'Locked split',
          detail: k.nDev !== null && k.nTest !== null ? `${k.nDev} development · ${k.nTest} test, stratified` : 'Development and test, stratified',
          anchor: 'validation',
        },
      ],
    },
    {
      id: 'develop',
      label: 'Develop',
      note: 'development set only',
      steps: [
        { title: 'Nested repeated CV', detail: folds, anchor: 'validation' },
        { title: 'Ensemble', detail: 'Logistic regression + boosted trees, blended in log-odds', anchor: 'models' },
        { title: 'Platt calibration', detail: 'Fitted on out-of-fold predictions', anchor: 'models' },
        { title: 'Decision threshold', detail: "Youden's J, per target", anchor: 'models' },
      ],
    },
    {
      id: 'explain',
      label: 'Explain & package',
      steps: [
        {
          title: 'Exact SHAP',
          detail: k.additivity !== null ? `Additive to < ${boundAbove(k.additivity)}` : 'Linear + tree SHAP, additive',
          anchor: 'explainability',
        },
        { title: 'Portable model', detail: 'One JSON: encoders, trees, calibration', anchor: 'engines' },
      ],
    },
    {
      id: 'serve',
      label: 'Serve',
      steps: [{ title: 'Server + edge engines', detail: `Python API and browser agree to < ${powerOfTen(-6)}`, anchor: 'engines' }],
    },
    {
      id: 'show',
      label: 'Show',
      steps: [{ title: '3D mapping', detail: 'Vessel colour = probability', anchor: 'anatomy' }],
    },
  ];
  let n = 0;
  return phases.map((ph) => ({ ...ph, steps: ph.steps.map((s) => ({ ...s, n: (n += 1) })) }));
}

// -------------------------------------------------------------------------------- dataset card

export interface CardRow {
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
}

/** Positives per target: the label co-occurrence diagonal when published, else prevalence × n. */
export function positives(report?: MetricsReport | null): Partial<Record<KnownTargetId, number>> {
  const out: Partial<Record<KnownTargetId, number>> = {};
  if (!report) return out;
  const co = (report.dataset as Rec).label_cooccurrence;
  if (isRec(co) && Array.isArray(co.targets) && Array.isArray(co.counts)) {
    co.targets.forEach((t, i) => {
      const row = (co.counts as unknown[])[i];
      const v = Array.isArray(row) ? num(row[i]) : null;
      if (typeof t === 'string' && v !== null) out[t as KnownTargetId] = v;
    });
    if (Object.keys(out).length > 0) return out;
  }
  for (const t of TARGET_ORDER) {
    const p = report.dataset.prevalence[t];
    if (typeof p === 'number') out[t] = Math.round(p * report.dataset.n);
  }
  return out;
}

export function datasetCard(report?: MetricsReport | null, schema?: FeatureSchema | null): CardRow[] {
  const ds = (report?.dataset ?? {}) as Rec;
  const rows: CardRow[] = [];
  const source = str(ds.source);
  rows.push({ label: 'Source', value: `${str(ds.name) ?? 'Extension of Z-Alizadeh Sani'} · UCI Machine Learning Repository`, href: source ?? undefined });
  const doi = str(ds.doi);
  if (doi) rows.push({ label: 'DOI', value: doi, href: `https://doi.org/${doi}`, mono: true });
  rows.push({ label: 'Licence', value: 'CC BY 4.0 (de-identified, public)' });
  const n = num(ds.n);
  rows.push({
    label: 'Population',
    value: `${n !== null ? `${n} adults` : 'Adults'} referred for coronary angiography at one tertiary centre`,
  });
  const nInputs = schema?.features.length ?? num(ds.n_features_used);
  const dropped = (schema?.dropped_features ?? (Array.isArray(ds.dropped_constant) ? (ds.dropped_constant as string[]) : [])).map((k) =>
    featureName(k).toLowerCase(),
  );
  const nGroups = schema ? new Set(schema.features.map((f) => f.group)).size : null;
  rows.push({
    label: 'Inputs',
    value: `${nInputs ?? 'All'} routine clinical inputs${nGroups ? ` in ${nGroups} modalities` : ''}${
      dropped.length ? `; ${dropped.join(' and ')} dropped as constant in development` : ''
    }`,
  });
  const pos = positives(report);
  if (n !== null && pos.CAD !== undefined) {
    const vessels = (['LAD', 'LCX', 'RCA'] as const)
      .filter((t) => pos[t] !== undefined)
      .map((t) => `${t} ${pos[t]}`)
      .join(', ');
    rows.push({
      label: 'Outcome',
      value: `Angiography, ≥ 50 % diameter narrowing: CAD in ${pos.CAD} (${formatPercent(pos.CAD / n)})${vessels ? `; stenotic ${vessels}` : ''}`,
    });
  }
  const nDev = num(ds.n_dev);
  const nTest = num(ds.n_test);
  if (nDev !== null && nTest !== null) {
    rows.push({ label: 'Split', value: `${nDev} development · ${nTest} locked test, stratified on the joint four-label pattern` });
  }
  const sha = str(ds.sha256);
  if (sha) rows.push({ label: 'Fingerprint', value: `SHA-256 ${sha.slice(0, 16)}…`, mono: true });
  return rows;
}

// ------------------------------------------------------------------------------ modality mix

export interface ModalityCount {
  id: string;
  name: string;
  count: number;
  examples: string[];
  bedside: boolean;
}

/** Inputs per modality in acquisition order, with three human-named examples each. */
export function modalityCounts(schema?: FeatureSchema | null): ModalityCount[] {
  if (!schema) return [];
  const byGroup = new Map<string, FeatureSpec[]>();
  for (const f of schema.features) byGroup.set(f.group, [...(byGroup.get(f.group) ?? []), f]);
  const order = [...MODALITY_ORDER, ...[...byGroup.keys()].filter((g) => !MODALITY_ORDER.includes(g))];
  return order
    .filter((g) => byGroup.has(g))
    .map((g) => {
      const fs = byGroup.get(g)!;
      return {
        id: g,
        name: modalityName(g),
        count: fs.length,
        examples: fs.slice(0, 3).map((f) => f.label),
        bedside: ['demographics', 'risk_factors', 'symptoms', 'exam'].includes(g),
      };
    });
}

// ------------------------------------------------------------------------------ leakage policy

export interface PolicyItem {
  title: string;
  body: string;
}

export function leakagePolicy(report?: MetricsReport | null): PolicyItem[] {
  const p = (report?.protocol ?? {}) as Rec;
  const seed = num(p.seed);
  const nTest = report?.dataset.n_test ?? null;
  const history = Array.isArray(p.test_set_history) ? p.test_set_history.length : 0;
  return [
    {
      title: 'Outcomes are never inputs',
      body: 'The LAD, LCX and RCA labels and the angiography result are excluded from the feature list. A unit test fails the build if any of them appears, and the API rejects requests that carry them.',
    },
    {
      title: 'The test split is locked first',
      body: `${nTest !== null ? `${nTest} patients were` : 'A fifth of the patients was'} set aside${seed !== null ? ` (seed ${seed})` : ''} before any modelling, stratified on the joint four-label pattern so every combination of diseased vessels is represented.`,
    },
    {
      title: 'Preprocessing lives inside the folds',
      body: 'Imputation, scaling and encoding are fitted on each training fold only. Constant columns are detected on the development set, never on the test set.',
    },
    {
      title: 'Tuning is nested',
      body: 'Hyper-parameters are searched by log-loss in an inner loop inside every outer training fold, so no outer fold influences the model it scores.',
    },
    {
      title: 'Post-hoc steps see only out-of-fold predictions',
      body: 'The ensemble weight, the Platt calibration and the decision threshold are fitted on out-of-fold predictions. The cross-validated numbers are cross-fitted: each outer fold re-makes those choices without itself.',
    },
    {
      title: 'The test set is scored once per release',
      body:
        history > 1
          ? `Only the deployed model and the pre-specified baseline are scored on it. It has been scored ${history} times in total, once per release; the re-score followed an independent review and changed no model choice.`
          : 'Only the deployed model and the pre-specified baseline are scored on it, after every modelling decision is frozen.',
    },
  ];
}

// ------------------------------------------------------------------------------- model table

export interface ModelRow {
  target: KnownTargetId;
  /** Table-sized name; `modelFull` goes in the tooltip. */
  model: string;
  modelFull: string;
  threshold: string;
  testAuc: string;
  testCi: string;
  cvAuc: string;
}

export function modelRows(report?: MetricsReport | null): ModelRow[] {
  if (!report) return [];
  return TARGET_ORDER.flatMap((t) => {
    const m = report.targets[t];
    if (!m) return [];
    const comp = (m as unknown as Rec).components;
    const lr = isRec(comp) && isRec(comp.logistic) ? str(comp.logistic.name) : null;
    const ci = m.test.roc_auc?.ci;
    return [
      {
        target: t,
        model: deployedModelShort(lr),
        modelFull: deployedModelName(lr),
        threshold: f2(m.threshold),
        testAuc: f2(m.test.roc_auc?.value),
        testCi: ci ? `${f2(ci[0])}–${f2(ci[1])}` : '',
        cvAuc: m.cv.roc_auc ? `${f2(m.cv.roc_auc.mean)} ± ${f2(m.cv.roc_auc.std)}` : '–',
      },
    ];
  });
}

export interface RejectedIdea {
  name: string;
  delta: string;
}

const VARIANT_NAMES: Record<string, string> = {
  derived: 'Derived ratios (neutrophil–lymphocyte, triglyceride–HDL, eGFR, risk-factor count)',
  selection: 'Univariate feature selection inside each fold',
  chain: 'Vessel models chained on the CAD probability',
};

/** Ideas tried on paired folds and rejected against the pre-registered adoption bar. */
export function rejectedIdeas(report?: MetricsReport | null): { bar: number | null; items: RejectedIdea[] } {
  const a = (report as unknown as Rec | undefined)?.ablations;
  if (!isRec(a) || !isRec(a.variants)) return { bar: null, items: [] };
  const items: RejectedIdea[] = [];
  for (const [id, v] of Object.entries(a.variants)) {
    if (!isRec(v) || v.adopted === true) continue;
    const d = num(v.mean_delta_auc);
    if (d === null) continue;
    const sign = d > 0 ? '+' : d < 0 ? '−' : '';
    items.push({ name: VARIANT_NAMES[id] ?? featureName(id), delta: `${sign}${Math.abs(d).toFixed(4)}` });
  }
  return { bar: num(a.min_gain), items };
}

// ------------------------------------------------------------------------------ anatomy pipeline

export interface AnatomyStep {
  title: string;
  detail: string;
}

export function anatomySteps(manifest?: AnatomyManifest | null): AnatomyStep[] {
  const m = (manifest ?? {}) as Rec;
  const structures = Array.isArray(m.structures) ? m.structures.length : null;
  const layers = Array.isArray(m.layers) ? m.layers.length : null;
  const territories = isRec(m.territories) ? str(m.territories.method) : null;
  const sigma = territories?.match(/sigma\s*=\s*([\d.]+)\s*mm/i)?.[1];
  const segments = Array.isArray(m.segments) ? m.segments.length : null;
  return [
    { title: 'BodyParts3D', detail: 'Open anatomy meshes named by the FMA, pinned by checksum' },
    { title: 'Blender', detail: `Scripted, headless build${layers !== null ? ` into ${layers} peelable layers` : ''}` },
    {
      title: 'Territories',
      detail: `Soft nearest-artery weights${sigma ? ` (σ = ${Number(sigma)} mm)` : ''} baked as vertex colours`,
    },
    { title: 'Centrelines', detail: 'Proximal → distal with lumen radius, for flow' },
    { title: 'SCCT segments', detail: segments ? `${segments} named coronary segments` : 'Coronary segment names from SCCT 2014' },
    { title: 'glTF', detail: `${structures !== null ? `${structures} named structures, ` : ''}compressed for the web` },
  ];
}

// ---------------------------------------------------------------------------------- references

export interface Reference {
  id: string;
  text: string;
  href?: string;
}

/** Numbered references; `cite(id)` returns the number used in the prose. */
export const REFERENCES: readonly Reference[] = [
  {
    id: 'dataset',
    text: 'Alizadehsani R, et al. Extension of Z-Alizadeh Sani dataset. UCI Machine Learning Repository; 2017.',
    href: 'https://doi.org/10.24432/C5461K',
  },
  {
    id: 'alizadehsani2013',
    text: 'Alizadehsani R, Habibi J, Hosseini MJ, et al. A data mining approach for diagnosis of coronary artery disease. Comput Methods Programs Biomed. 2013;111(1):52–61.',
    href: 'https://doi.org/10.1016/j.cmpb.2013.03.004',
  },
  {
    id: 'tripod',
    text: 'Collins GS, Moons KGM, Dhiman P, et al. TRIPOD+AI statement: updated guidance for reporting clinical prediction models that use regression or machine learning methods. BMJ. 2024;385:e078378.',
    href: 'https://doi.org/10.1136/bmj-2023-078378',
  },
  {
    id: 'kaufman',
    text: 'Kaufman S, Rosset S, Perlich C, Stitelman O. Leakage in data mining: formulation, detection, and avoidance. ACM Trans Knowl Discov Data. 2012;6(4):15.',
    href: 'https://doi.org/10.1145/2382577.2382579',
  },
  {
    id: 'varma',
    text: 'Varma S, Simon R. Bias in error estimation when using cross-validation for model selection. BMC Bioinformatics. 2006;7:91.',
    href: 'https://doi.org/10.1186/1471-2105-7-91',
  },
  {
    id: 'nadeau',
    text: 'Nadeau C, Bengio Y. Inference for the generalization error. Mach Learn. 2003;52:239–281.',
    href: 'https://doi.org/10.1023/A:1024068626366',
  },
  {
    id: 'holm',
    text: 'Holm S. A simple sequentially rejective multiple test procedure. Scand J Stat. 1979;6(2):65–70.',
    href: 'https://www.jstor.org/stable/4615733',
  },
  {
    id: 'xgboost',
    text: 'Chen T, Guestrin C. XGBoost: a scalable tree boosting system. Proc 22nd ACM SIGKDD. 2016:785–794.',
    href: 'https://doi.org/10.1145/2939672.2939785',
  },
  {
    id: 'platt',
    text: 'Platt JC. Probabilistic outputs for support vector machines and comparisons to regularized likelihood methods. In: Advances in Large Margin Classifiers. MIT Press; 1999:61–74.',
  },
  {
    id: 'youden',
    text: 'Youden WJ. Index for rating diagnostic tests. Cancer. 1950;3(1):32–35.',
    href: 'https://doi.org/10.1002/1097-0142(1950)3:1%3C32::AID-CNCR2820030106%3E3.0.CO;2-3',
  },
  {
    id: 'calibration',
    text: 'Van Calster B, McLernon DJ, van Smeden M, et al. Calibration: the Achilles heel of predictive analytics. BMC Med. 2019;17:230.',
    href: 'https://doi.org/10.1186/s12916-019-1466-7',
  },
  {
    id: 'dca',
    text: 'Vickers AJ, Elkin EB. Decision curve analysis: a novel method for evaluating prediction models. Med Decis Making. 2006;26(6):565–574.',
    href: 'https://doi.org/10.1177/0272989X06295361',
  },
  {
    id: 'shap',
    text: 'Lundberg SM, Lee S-I. A unified approach to interpreting model predictions. Adv Neural Inf Process Syst. 2017;30.',
    href: 'https://arxiv.org/abs/1705.07874',
  },
  {
    id: 'treeshap',
    text: 'Lundberg SM, Erion G, Chen H, et al. From local explanations to global understanding with explainable AI for trees. Nat Mach Intell. 2020;2:56–67.',
    href: 'https://doi.org/10.1038/s42256-019-0138-9',
  },
  {
    id: 'modelcards',
    text: 'Mitchell M, Wu S, Zaldivar A, et al. Model cards for model reporting. Proc FAT* 2019:220–229.',
    href: 'https://doi.org/10.1145/3287560.3287596',
  },
  {
    id: 'bodyparts3d',
    text: 'Mitsuhashi N, Fujieda K, Tamura T, et al. BodyParts3D: 3D structure database for anatomical concepts. Nucleic Acids Res. 2009;37:D782–D785.',
    href: 'https://doi.org/10.1093/nar/gkn613',
  },
  {
    id: 'scct',
    text: 'Leipsic J, Abbara S, Achenbach S, et al. SCCT guidelines for the interpretation and reporting of coronary CT angiography. J Cardiovasc Comput Tomogr. 2014;8(5):342–358.',
    href: 'https://doi.org/10.1016/j.jcct.2014.07.003',
  },
  {
    id: 'aha17',
    text: 'Cerqueira MD, Weissman NJ, Dilsizian V, et al. Standardized myocardial segmentation and nomenclature for tomographic imaging of the heart. Circulation. 2002;105(4):539–542.',
    href: 'https://doi.org/10.1161/hc0402.102975',
  },
];

export function cite(id: string): number {
  const i = REFERENCES.findIndex((r) => r.id === id);
  return i + 1;
}
