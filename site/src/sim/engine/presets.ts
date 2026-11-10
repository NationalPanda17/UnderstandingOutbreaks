/** Disease-flavoured presets. Illustrative only: they set a *range* for one teaching parameter and never describe a
 *  real outbreak. Every cited value was checked against the source abstract on the date shown, or is marked unverified.
 *  All presets are flagged for human review in docs/SOURCES.md. Never add a number here without a verifiable source. */
import type { Options } from './templates';

export interface Citation { text: string; doi?: string; url?: string; verified: string | null; verifiedHow?: string }
export interface Preset {
  id: string;
  source_id: 'literature';
  origin_type: 'simulated';
  /** Range shown to the user for the reproduction number; the slider starts in the middle. Null = no cited range. */
  r0Range: [number, number] | null;
  options: Partial<Options>;
  /** Parameters that are illustrative round numbers with no citation (shown as "unverified, user-supplied"). */
  unverified: string[];
  citations: Citation[];
}

export const PRESETS: Preset[] = [
  {
    id: 'measles-like', source_id: 'literature', origin_type: 'simulated', r0Range: [12, 18],
    options: { template: 'SEIR', R0: 15, incubationDays: 10, infectiousDays: 8, days: 120 },
    unverified: ['incubationDays', 'infectiousDays'],
    citations: [{ text: 'Guerra FM, Bolotin S, Lim G, Heffernan J, Deeks SL, Li Y, Crowcroft NS. The basic reproduction number (R0) of measles: a systematic review. Lancet Infect Dis. 2017;17(12):e420–e428. The abstract states that R0 "is often cited to be 12–18" and that estimates "vary more than the often cited range".', doi: '10.1016/S1473-3099(17)30307-9', verified: '2026-11-10', verifiedHow: 'range read from the PubMed abstract (PMID 28757186)' }],
  },
  {
    id: 'influenza-like', source_id: 'literature', origin_type: 'simulated', r0Range: [1.19, 1.37],
    options: { template: 'SEIR', R0: 1.28, incubationDays: 2, infectiousDays: 4, days: 300 },
    unverified: ['incubationDays', 'infectiousDays'],
    citations: [{ text: 'Biggerstaff M, Cauchemez S, Reed C, Gambhir M, Finelli L. Estimates of the reproduction number for seasonal, pandemic, and zoonotic influenza: a systematic review of the literature. BMC Infect Dis. 2014;14:480. The abstract reports a median R for seasonal influenza of 1.28 (interquartile range 1.19–1.37).', doi: '10.1186/1471-2334-14-480', verified: '2026-11-10', verifiedHow: 'values read from the PubMed abstract (PMID 25186370)' }],
  },
  {
    id: 'cholera-like', source_id: 'literature', origin_type: 'simulated', r0Range: null,
    options: { template: 'water', R0: 2, infectiousDays: 5, waterShare: 0.6, waterDecayDays: 20, days: 300 },
    unverified: ['R0', 'infectiousDays', 'waterShare', 'waterDecayDays'],
    citations: [{ text: 'No value in this preset has been verified against a published source. It only selects the waterborne teaching template with round-number settings.', verified: null }],
  },
];

/** Literature behind the methods (shown on the references page). Unverified entries are labelled as such. */
export const METHOD_REFERENCES: Citation[] = [
  { text: 'Guerra FM et al. The basic reproduction number (R0) of measles: a systematic review. Lancet Infect Dis. 2017;17(12):e420–e428.', doi: '10.1016/S1473-3099(17)30307-9', verified: '2026-11-10', verifiedHow: 'PubMed record and abstract' },
  { text: 'Biggerstaff M et al. Estimates of the reproduction number for seasonal, pandemic, and zoonotic influenza: a systematic review of the literature. BMC Infect Dis. 2014;14:480.', doi: '10.1186/1471-2334-14-480', verified: '2026-11-10', verifiedHow: 'PubMed record and abstract' },
  { text: 'Lloyd-Smith JO, Schreiber SJ, Kopp PE, Getz WM. Superspreading and the effect of individual variation on disease emergence. Nature. 2005;438:355–359. (Negative-binomial offspring distribution and the dispersion parameter k.)', doi: '10.1038/nature04153', verified: '2026-11-10', verifiedHow: 'bibliographic record checked against Crossref (existence, title, journal, pages); content not re-read' },
  { text: 'van den Driessche P, Watmough J. Reproduction numbers and sub-threshold endemic equilibria for compartmental models of disease transmission. Math Biosci. 2002;180:29–48. (Next-generation matrix construction.)', doi: '10.1016/S0025-5564(02)00108-6', verified: '2026-11-10', verifiedHow: 'bibliographic record checked against Crossref (existence, title, journal, pages); content not re-read' },
  { text: 'Kermack WO, McKendrick AG. A contribution to the mathematical theory of epidemics. Proc R Soc Lond A. 1927;115:700–721. (SIR model and final-size relation.)', doi: '10.1098/rspa.1927.0118', verified: '2026-11-10', verifiedHow: 'bibliographic record checked against Crossref (existence, title, journal, pages); content not re-read' },
  { text: 'Gillespie DT. Exact stochastic simulation of coupled chemical reactions. J Phys Chem. 1977;81(25):2340–2361. (Exact stochastic simulation algorithm.)', doi: '10.1021/j100540a008', verified: '2026-11-10', verifiedHow: 'bibliographic record checked against Crossref (existence, title, journal, pages); content not re-read' },
  { text: 'Tien JH, Earn DJD. Multiple transmission pathways and disease dynamics in a waterborne pathogen model. Bull Math Biol. 2010;72:1506–1533. (Waterborne SIWR teaching template.)', doi: '10.1007/s11538-010-9507-6', verified: '2026-11-10', verifiedHow: 'bibliographic record checked against Crossref (existence, title, journal, pages); content not re-read' },
  { text: 'Hutwagner L, Thompson W, Seeman GM, Treadwell T. The bioterrorism preparedness and response Early Aberration Reporting System (EARS). J Urban Health. 2003;80(2 Suppl 1):i89–i96. (Rolling-baseline aberration methods that the site\'s signal flags are modelled on.)', doi: '10.1007/PL00022319', verified: '2026-11-10', verifiedHow: 'bibliographic record checked against Crossref (existence, title, journal, pages); content not re-read' },
];
