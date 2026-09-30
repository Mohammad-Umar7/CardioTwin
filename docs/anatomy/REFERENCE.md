# CardioTwin anatomical reference

The target anatomy for the CardioTwin 3D thorax, heart and coronary tree. Every fact carries a source link. The
numbered criteria in [`anatomy/checks/reference_checks.yaml`](../../anatomy/checks/reference_checks.yaml) turn these
facts into tests; check IDs such as `COR-10` are shown next to the facts they test.

*Version 1.0 (2026-09-30). This document merges three research dossiers: coronary arteries, cardiac veins, and heart
position with the great vessels. Where the sources disagree, §9 records which value was adopted and why.*

**Contents**

- [0. Conventions](#0-conventions)
- [1. Position and orientation](#1-position-and-orientation)
- [2. Chambers and surfaces](#2-chambers-and-surfaces)
- [3. Great vessels](#3-great-vessels)
- [4. Valves](#4-valves)
- [5. Coronary arteries](#5-coronary-arteries)
- [6. Cardiac veins](#6-cardiac-veins)
- [7. Colour conventions](#7-colour-conventions)
- [8. Common variants](#8-common-variants)
- [9. Editorial decisions](#9-editorial-decisions-resolved-contradictions)
- [10. Snapshot of the current asset](#10-snapshot-of-the-current-asset-2026-09-30)
- [11. Sources](#11-sources)

---

## 0. Conventions

| Item | Convention |
| --- | --- |
| Frame | [CONTRACTS §6.1](../CONTRACTS.md): +X is patient-left, +Y is superior, +Z is anterior. |
| Units | 1 scene unit (u) = 10 cm. So **1 cm = 0.1 u** and **1 mm = 0.01 u**. |
| Origin | Centre of the heart-wall bounding box. **This is not the body midline.** In the current asset the midline (`X_mid`, the median X of the sternum) is at X ≈ −0.23 u. |
| Values | Adult and in vivo (CT, CMR or echocardiography) unless stated otherwise. Written as mean ± SD, with the range in brackets. |
| Grades | **H (hard)** is an anatomical invariant. A failure is an error unless a named variant (§8) has been declared. **S (soft)** is a population statistic. A failure is a warning. |
| Default phenotype | Adult, right-dominant coronary circulation, no ramus intermedius, no myocardial bridge, 2 + 2 pulmonary veins, three-branch aortic arch. Any other variant must be declared on purpose. |

**How conflicts are resolved (evidence ranking).**

1. Guideline and consensus documents: SCCT, AHA, ASE/EACVI.
2. Meta-analyses and large imaging cohorts.
3. Single imaging series.
4. Cadaver series.
5. Educational references: Kenhub, Radiopaedia, TeachMeAnatomy, StatPearls.

For vessel calibre, in-vivo imaging is preferred over cadaver data, because cadaver veins and arteries collapse.

**Landmarks** (full operational definitions are in the YAML file, section `landmarks`):

- `X_mid`: the midline.
- `T1…T12`: vertebral levels.
- `CC_L(n)`, `CC_R(n)`: left and right costal cartilages.
- `ICS_L(n)`: left intercostal spaces.
- `Y_JN`: the jugular notch.
- `Y_SA`: the sternal angle.
- `MCL_L`: the left mid-clavicular line.
- `apex`, `base_center` and `u_ba` (the unit vector from base to apex): from `manifest.heart`.
- `trunk(v)`: `vessels.json` segment 0 of vessel `v`, ordered proximal → distal.

---

## 1. Position and orientation

### 1.1 Mediastinal position and axis

| Fact | Reference value | Expected in the scene frame | Source | Check |
| --- | --- | --- | --- | --- |
| Compartment and level | Middle mediastinum, T5–T8 lying down | Heart-wall Y spans about T5 to T8 (±1 level) | [SP-MED] | POS-06 |
| Left/right split | About 2/3 of the heart lies left of the midline and 1/3 right | Fraction of heart-wall area with X > `X_mid` is 0.60–0.75 | [SP-MED], [LT-POS] | POS-01 |
| Long-axis direction | From the right shoulder toward the left hypochondrium. The apex points forward, down and to the left | `apex − base_center` has +X, −Y and +Z components | [LT-POS], [KH-APEX] | POS-02 |
| Septum vs median plane | About 45° | Angle between `u_ba` and the YZ plane is 35–60° | [LT-POS] | POS-03 |
| Measured long-axis tilt (CT, n = 59) | 38.1 ± 7.8° (20.9–56.2°), measured from LV apex to the mitral-annulus centre against bony landmarks | Frontal (XY) projection of `u_ba` lies 21–56° below +X | [BJC2015] | POS-03 |
| Effect of age | More vertical in young people, more horizontal in older people | Explains the width of the tolerance | [RADASSIST] | – |

### 1.2 Surface projection (anatomical, not auscultation points)

| Border / point | Projection on the chest wall | Formed by | Source | Check |
| --- | --- | --- | --- | --- |
| Superior border | Lower border of the left 2nd costal cartilage (CC2) to the upper border of the right CC3 | Both atria and the great vessels | [KH-SURF], [TMA-BORD] | POS-06 |
| Right border | Right CC3 to right CC6. Convex, about 1–2 cm lateral to the sternal edge | RA | [KH-SURF], [GPN-PERI], [TMA-BORD] | CHM-02 |
| Inferior border | Right CC6 to the apex, nearly horizontal. Rests on the central tendon of the diaphragm | RV, with the LV near the apex | [KH-SURF], [TMA-BORD] | POS-10 |
| Left border | Left CC2 to the apex | LV, plus a little of the LA auricle | [KH-SURF], [TMA-BORD] | – |
| Apex | Left 5th intercostal space (ICS) at the mid-clavicular line, 8–9 cm from the midline | LV | [KH-SURF], [KH-APEX], [LT-POS] | POS-04, POS-05 |
| Coronary (AV) sulcus | Sternal end of the left CC3 to the right 6th chondrosternal joint | – | [KH-SULCUS] | – |

### 1.3 Size

- **Excised specimen:** about 12 cm from base to apex, 8–9 cm wide and about 6 cm front to back. Mass is 280–340 g in men and 230–280 g in women [CV-SIZE], [LT-SIZE].
- **In situ, chest radiograph (n = 1,047):**
  - Transverse cardiac diameter: 13.8 ± 1.2 cm in men and 12.9 ± 1.3 cm in women.
  - Cardiothoracic ratio (CTR): 0.466 ± 0.039 in men and 0.478 ± 0.048 in women [BRAKO2017].
  - A CTR below 0.50 on a PA film is normal [RP-CTR].
  - Checks: POS-07, POS-08.
- **Converting volume to mass:** myocardial density is 1.04 g/mL (the ASE LV-mass constant) [ASE2015].
- **Editorial:** the 6 cm depth describes an empty, excised heart. A filled heart in situ is deeper, so depth is **not tested**. The checks use the long axis, the transverse diameter and the CTR instead (§9).

### 1.4 Thoracic landmarks and neighbours

| Landmark | Level / relation | Source | Check |
| --- | --- | --- | --- |
| Sternal angle | CC2, level with the T4/T5 disc | [SA-LEVEL] | landmarks |
| Carina | T4/T5. Subcarinal angle 73 ± 16° (34–107°); it widens when the LA is enlarged | [KH-CARINA], [CARINA-ANGLE] | POS-11 |
| Pulmonary-trunk bifurcation | T5–T6 (range: T4/5 disc to T7) | [PA-BIF] | GV-09 |
| Aortic arch | Starts and ends at the T4 level (sternal-angle plane). Its top is about 2.5 cm below the jugular notch | [RP-ARCH], [AA-AORTA] | GV-03 |
| IVC hiatus | T8, through the central tendon | [SP-IVC] | GV-12 |
| Diaphragm (expiration) | Right dome at the 5th rib, left dome at the 5th ICS, so the right dome is higher. The central tendon is at the xiphisternal level | [DIAPH] | POS-10 |
| Pericardium | Fibrous layer fused to the central tendon and tied to the sternum. Transverse sinus lies behind the aorta and pulmonary trunk and in front of the SVC. Under 2 mm thick on CT. Holds 15–50 mL of fluid | [TMA-PERI], [PERI-CT], [KH-PERI] | – |
| Left lung | The cardiac notch is deepest at the 5th ICS, leaving a "bare area" of pericardium. The lingula lies below it | [IMAIOS-NOTCH] | POS-09 |
| Oesophagus | Directly behind the LA below about T5. Contact is 58 ± 14 mm long and 13 ± 6 mm wide. Its wall is under 5 mm from the LA endocardium in 40% of specimens. Near the diaphragm the aorta lies directly behind it | [LEMOLA2004], [SANCHEZ2005], [IMAIOS-OES] | – (no node yet) |

---

## 2. Chambers and surfaces

### 2.1 Which chamber forms which surface

| Surface / border | Chamber(s) | Source |
| --- | --- | --- |
| Anterior (sternocostal) surface | Mainly the RV | [TMA-BORD] |
| Base (posterior surface) | LA | [TMA-BORD] |
| Diaphragmatic (inferior) surface | LV and RV | [TMA-BORD] |
| Right border and right pulmonary surface | RA | [TMA-BORD] |
| Left border and left pulmonary surface | LV, plus the LA auricle | [TMA-BORD] |

### 2.2 Relative positions

- The right-heart chambers lie in front of the left-heart chambers [LT-POS].
- Each ventricle lies below and to the left of its atrium [LT-POS].
- The LA is the most posterior chamber and sits directly in front of the oesophagus [LT-POS].
- The RV is more anterior than lateral. The RA lies below the LA [RADASSIST].
- The LA appendage sits on the upper left border, above the left AV groove. The RA appendage covers the right AV groove and the root of the aorta [RADASSIST].
- The crux is where the posterior interventricular (IV) groove meets the AV groove.
- Checks: CHM-01, CHM-02.

### 2.3 Chamber dimensions (ASE/EACVI 2015) [ASE2015]

| Measure | Men | Women | In scene units |
| --- | --- | --- | --- |
| LV end-diastolic internal diameter | 4.2–5.8 cm | 3.8–5.2 cm | 0.38–0.58 u |
| LV septal and posterior wall | 0.6–1.0 cm | 0.6–0.9 cm | 0.06–0.10 u |
| LA front-to-back diameter | 3.0–4.0 cm | 2.7–3.8 cm | 0.27–0.40 u |
| RV basal / mid diameter | Abnormal if > 4.1 / > 3.5 cm | – | ≤ 0.41 / ≤ 0.35 u |
| RV free wall | Abnormal if > 0.5 cm | – | ≤ 0.05 u |
| IVC | Normal if < 2.1 cm | – | < 0.21 u |

---

## 3. Great vessels

### 3.1 Aorta

| Part | Course and relations | Size | Source | Check |
| --- | --- | --- | --- | --- |
| Root | Sinuses of Valsalva. The STJ caps the root | Sinus 29–40 mm; STJ 22–36 mm | [IMAIOS-SOV], [IMAIOS-STJ] | GV-02 |
| Ascending | Starts behind the left half of the sternum at the lower border of the left CC3. Runs up and slightly right to the sternal angle | About 5 cm long. At the PA-bifurcation level: **33 ± 4 mm** (upper normal 41 mm), non-contrast CT, n = 4,039 | [KH-AORTA], [WOLAK2008] | GV-01, GV-02 |
| Arch | Starts and ends at T4. Top is about 2.5 cm below the jugular notch. Runs back and to the left, in front of and then left of the trachea, over the right PA and the left main bronchus. The ligamentum arteriosum attaches underneath; the isthmus is just beyond the left subclavian | – | [RP-ARCH], [AA-AORTA], [KH-AORTA] | GV-03, GV-04 |
| Arch branches | Brachiocephalic → left common carotid → left subclavian, from right to left, in about 75–81% | – | [ARCH-VAR], [RP-ARCH] | – |
| Descending thoracic | T4 to T12. Starts left of the vertebral bodies and drifts to the midline by T12. Behind the LA and oesophagus | At the PA-bifurcation level: **24 ± 3 mm** (upper normal 30 mm) | [KH-AORTA], [WOLAK2008], [IMAIOS-OES] | GV-05, GV-06 |

### 3.2 Pulmonary trunk and arteries

- **Origin and course:** the trunk leaves the RV conus in front of the ascending aorta. It runs up and back, passing to the left of the aorta. It is about 5 cm long [KH-PT], [IMAIOS-PT]. Check: GV-07.
- **Calibre (Framingham CT):** the 90th-percentile main-PA diameter is about 29 mm in men and 27 mm in women. The PA : ascending-aorta ratio is normally ≤ 0.9 [FRAM-PA]. Check: GV-08.
- **Bifurcation:** T5–T6 (T4/5 to T7). It sits in the concavity of the arch, below and in front of the carina [PA-BIF], [KH-PT], [KH-CARINA]. Check: GV-09.
- **Right and left PA:** the right PA is longer and passes under the arch **behind the ascending aorta and SVC**. The left PA is shorter and arches **over the left main bronchus** [KH-PT]. Check: GV-09.

### 3.3 Venae cavae

- **SVC** [TMA-SVC]. Checks: GV-10, GV-11.
  - Formed behind the right CC1 where the brachiocephalic veins join.
  - About 7 cm long and up to about 2 cm across.
  - Runs vertically, to the right of the ascending aorta and trachea.
  - Receives the azygos vein at T4.
  - Empties into the roof of the RA at the right CC3.
- **IVC:** passes through the central tendon at T8, has only a short course in the chest, and enters the posteroinferior RA [SP-IVC], [KH-IVC]. Diameter is under 2.1 cm [ASE2015]. Check: GV-12.

### 3.4 Pulmonary veins

- **Entry:** usually four veins enter the smooth posterior-superior wall of the LA. The right veins pass behind the RA and SVC. The left veins pass in front of the descending aorta [KH-PV], [KH-PAPV]. Check: GV-13.
- **Pattern:** the classic 2 + 2 pattern occurs in 61–71%. A left common trunk occurs in 15–27%, and a right middle vein in 19–26% [PV-VAR-BMC], [PV-VAR-SRA], [PV-VAR-RG].
- **Ostial diameters (CT)** [PV-DIAM]:
  - Right superior 11.4–12.4 mm; right inferior 12.3–13.1 mm.
  - Left superior 9.6–10.5 mm; left inferior 9.0–9.9 mm.
  - So the right ostia are larger than or equal to the left.

---

## 4. Valves

### 4.1 Anatomical projection

Auscultation points are different and must not be used for testing.

| Valve | Projection | Source | Check |
| --- | --- | --- | --- |
| Pulmonary | Junction of the sternum and the left CC3 | [KH-SURF] | VLV-01 |
| Aortic | Behind the left half of the sternum at the 3rd ICS | [KH-SURF] | VLV-01 |
| Mitral | Left side of the sternum at the 4th CC | [KH-SURF] | VLV-01 |
| Tricuspid | Right side of the sternum at the 4th CC | [KH-SURF] | VLV-01 |

### 4.2 Relative position and fibrous skeleton

- The pulmonary valve is **anterior, superior and to the left** of the aortic valve. The two outflow tracts cross [KH-VALVES]. Check: VLV-02.
- The aortic valve is central in the fibrous skeleton and in **fibrous continuity with the anterior mitral leaflet** [KH-SKEL]. Check: VLV-05.
- The mitral valve is posterosuperior to the tricuspid and posteroinferior to the aortic orifice [KH-VALVES]. Checks: VLV-03, VLV-04.
- The tricuspid septal-leaflet hinge normally sits slightly closer to the apex than the mitral hinge, by less than 8 mm/m² of body-surface area. A larger offset suggests Ebstein's anomaly [EBSTEIN]. Check: VLV-04.
- The aorto-mitral angle is 131 ± 10° [AO-MITRAL]. The aortic annulus is less than 48° to the horizontal in most people ("horizontal aorta" in 42% of one TAVI cohort) [HORIZ-AO]. These are informative only.

### 4.3 Annulus sizes

These feed check VLV-06.

| Annulus | Value | Source |
| --- | --- | --- |
| Mitral | Specimen circumference 7 cm (women) to 9 cm (men). In-vivo front-to-back diameter 2.6–3.3 cm (the test uses the in-vivo value) | [KH-VALVES], [ANN-CMR] |
| Tricuspid | Specimen circumference 10–11 cm, so larger than the mitral. Four-chamber diameter 2.8–3.2 cm. CT diameter 28.9 ± 4.5 mm | [KH-VALVES], [ANN-JACC], [KOCH2017] |
| Aortic / pulmonary | About 18–29 mm / 17–25 mm (low-grade source, used only as a sanity range) | [ANN-PATENT] |

---

## 5. Coronary arteries

Territory, dominance and the segment tables here are the basis for CardioTwin's risk mapping (CONTRACTS §6.2 and
§7.1). Risk stays at the **vessel level**: segments are anatomical labels, never lesion locations.

### 5.1 Aortic root and ostia

- **Sinuses:**
  - Right (anterior) sinus → RCA.
  - Left (left-posterior) sinus → left main (LM).
  - Non-coronary (right-posterior) sinus → no ostium.
  - Sources: [IMAIOS-SINUS], [PCR-ROOT]. Check: COR-01.
- **Ostial height above the annulus (MDCT):** LCA 14.4 ± 2.9 mm (7.1–22.7); RCA 17.2 ± 3.3 mm [TOPS2008]. Post-mortem values are 12.6 / 13.2 mm [PCR-ROOT]. So the RCA ostium is usually a few mm **higher** than the LCA ostium. Check: COR-02.
- **Relation to the STJ:** most ostia are below it. About 9% are at the STJ and about 22% above it [PCR-ROOT].
- **Number and take-off:** 2 ostia is usual, and 2–4 is normal (for example a separate conus ostium, or separate LAD and LCX ostia). The vessel leaves the aortic wall at about 45–90° [VILLA2016].

### 5.2 Left main (SCCT segment 5)

- **Course:** leftward from the left sinus, **behind the pulmonary trunk**, then between the trunk and the left auricle, inside subepicardial fat. It has no branches before it divides [RP-LM], [KH-LCA]. Check: COR-04.
- **Length:**
  - CT atlas (n = 293): 10.5 ± 5.3 mm [MEDRANO].
  - CTA: 9.13 ± 3.23 mm (2–19.5). The length falls in the 5–15 mm band in 87% [NEI2023].
  - Radiopaedia gives 5–10 mm [RP-LM].
  - Check: COR-03.
- **Lumen diameter:** 3.5 ± 0.8 mm (CT atlas) [MEDRANO]; 4.5 ± 0.5 mm (angiography) [DODGE1992]; 4.41 ± 0.67 mm (IVUS) [IVUS-LM]. Check: COR-03.
- **Division:**
  - A bifurcation into LAD and LCX in about 70–85%.
  - A trifurcation with a ramus intermedius (segment 17) in 15–32% [RP-RI], [NEI2023].
- **Angles:** LAD–LCX angle 75 ± 23° without a ramus and 89 ± 21° with one [MEDRANO]; 77.9 ± 19.8° [NEI2023]; mean 63° [ANGLES]. LM–LAD angle about 37.5° [ANGLES]. Check: COR-05.
- **Finet ratio** (LM diameter ÷ sum of the daughter diameters): 0.66 ± 0.08 [MEDRANO].

### 5.3 Left anterior descending (LAD)

- **Course:** it runs down the **anterior IV groove** from the end of the LM toward the apex, over the septum between the RV and the LV [RP-LAD], [KH-LAD]. Check: COR-06.
- **Supplies:** the anterior and anterolateral LV, the apex, and the anterior two-thirds of the septum.
- **Length:** 109.5 ± 14.5 mm (72–145) [NEI2023]; 10–13 cm [VILLA2016]. Check: COR-07.
- **Diagonals** [RP-LAD], [NEI2023]. Check: COR-08.
  - They leave toward the patient's **left** and run over the anterolateral LV free wall.
  - Count: 1 in 14%, 2 in 62%, more than 2 in 24%.
  - D1 is "large" when it is > 1.5 mm, which matters for the SCCT boundary [SCCT2014].
- **Septal perforators** [SEPTAL]. Check: COR-09.
  - They dive into the septum at 45–90°.
  - The main septal is 1.5–2.0 mm across.
  - Anterior septals are 40–80 mm long. Inferior septals (from the PDA) are 15 mm or shorter.
- **Termination:** the LAD wraps around the apex onto the inferior surface in about 73–78% of hearts: 47% of right-dominant vs 87% of left-dominant hearts [WRAP], [WRAP-REV]. Check: COR-06.
- **Myocardial bridge** [BRIDGE]:
  - Pooled prevalence 19% (autopsy 42%, CT 22%, angiography 6%).
  - 82% are on the LAD, usually the mid-LAD.
  - Mean length 19.3 mm; mean muscle thickness 2.5 mm.

### 5.4 Left circumflex (LCX)

- **Course:** in the **left AV groove**, between the LA and LV. It runs back along the mitral annulus toward the obtuse margin and the diaphragmatic surface [RP-LCX], [KH-BLOOD]. Check: COR-10.
- **Supplies:** the lateral and inferolateral LV and the LA.
- **Length:** 66.3 ± 11.6 mm (41–108) [NEI2023]; 5–8 cm [VILLA2016]. On average the LAD is about 1.65 times the length of the LCX. Check: COR-11.
- **Obtuse marginals (OM)** run **toward the apex** over the lateral LV wall [RP-LCX]. Count: 1 in 20%, 2 in 51%, more than 2 in 29% [NEI2023]. Check: COR-12.
- **Termination:** in right-dominant hearts the LCX ends in the AV groove **before the crux** [KH-LCA]. Check: COR-19.
- **Relation to the coronary sinus:** the LCX runs between the coronary sinus (CS) / great cardiac vein (GCV) and the mitral annulus in 68% [TOPS2007]. The minimum CS–LCX distance is 1.3 ± 1.0 mm [TOPS2007]. Check: VEN-06.

### 5.5 Right coronary artery (RCA)

- **Course** [KH-RCA], [KH-BLOOD], [RP-RCA]. Check: COR-13.
  1. Leaves the right sinus heading forward, between the right auricle and the pulmonary trunk / RV outflow tract.
  2. Descends in the **right AV groove** next to the tricuspid annulus.
  3. Rounds the **acute margin**.
  4. Follows the inferior AV groove to the **crux**.
- **Length to the crux:** 12–14 cm [VILLA2016]. Check: COR-14.
- **Branch order:** conus, SA-nodal, anterior RV branches, acute marginal, AV-nodal, PDA, then posterolateral branches (PLB) [KH-RCA], [RP-RCA].
- **Conus branch:** it has its own right-sinus ostium ("third coronary") in 40.3%. It is an RCA branch in 32.1%, shares an ostium with the RCA in 16%, and is multiple in 8% [CONAL]. Radiopaedia gives up to about 50% for a separate ostium [RP-RCA].
- **SA-nodal artery** (n = 21,455): from the RCA 68.0%, the LCX 22.1%, the LCA 2.7%. It is single in 95.5% and passes behind the SVC in 47.1% [SAN].
- **AV-nodal artery** (n = 3,919): from the RCA 82.4% and the LCA 15.3%. About 22.6 mm long and 1.4 mm across at its origin [AVN].
- **Acute marginal and RV branches** stay on the RV free wall [RP-RCA], [TMA-VASC]. Check: COR-16.
- **PDA** runs in the **posterior (inferior) IV groove** toward the apex. It gives short inferior septals to the posterior third of the septum [RP-PDA], [SEPTAL]. Check: COR-17.
- **R-PLB** continues past the crux into the left AV groove and supplies the inferior and inferolateral LV [RP-RCA], [SCCT2014]. Check: COR-18.
- **Shepherd's crook RCA:** a high, tortuous proximal loop in about 5% [RP-SHEP]. Check: COR-15.

### 5.6 Dominance

Dominance is defined by **which artery gives the PDA** and the posterolateral branches [RP-DOM], [CONFIRM].

| Source | Right | Left | Co-dominant |
| --- | --- | --- | --- |
| JAHA 2024 review (**adopted**) [WU2024] | ≈ 85% | ≈ 8% | ≈ 7% |
| CONFIRM CCTA, n = 6,382 (co-dominance not separated) [CONFIRM] | 91% | 9% | – |
| CCTA, n = 677 [DOM-CCTA] | 89.7% | 8.0% | 2.3% |
| Angiography [DOM-ANGIO] | 85.7% | 11.6% | 2.7% |

- **Effect on calibre:** the proximal RCA is 3.9 ± 0.6 mm in right-dominant hearts vs 2.8 ± 0.5 mm in left-dominant hearts. The proximal LCX is 3.4 ± 0.5 vs 4.2 ± 0.6 mm [DODGE1992].
- **The model** is right-dominant, which is also what the manifest's `territories.interpretation` declares. Check: COR-19.

### 5.7 Lumen calibre (mm) and taper

Proximal / mid / distal lumen diameters:

| Vessel | CT controls, n = 47 [CT-REF] | Angiography [DODGE1992] | CT, men / women [SEX-DIAM] |
| --- | --- | --- | --- |
| LM | 4.5 ± 0.81 | 4.5 ± 0.5 | 4.28 / 3.92 |
| LAD | 3.54 ± 0.67 / 2.41 ± 0.64 / 1.64 ± 0.52 | 3.7 ± 0.4 (p) / 1.9 ± 0.4 (d) | 3.54 / 3.37 (p) |
| LCX | 3.07 ± 0.77 / 2.17 ± 0.73 / 1.62 ± 0.61 | 3.4 ± 0.5 (p, right-dominant) | 3.05 / 2.94 (p) |
| RCA | 3.43 ± 0.56 / 3.19 ± 0.67 / 2.63 ± 0.59 | 3.9 ± 0.6 (p, right-dominant) | 3.26 / 3.14 (p) |

- **Proximal order:** LM > pLAD ≥ pRCA > pLCX in right-dominant hearts [SEX-DIAM], [IND-DIAM]. Check: COR-20.
- **Sex:** women's arteries are about 9% smaller [DODGE1992].
- **Taper:**
  - The LAD narrows by about 0.25 mm per 10 mm. The RCA first widens slightly and then tapers slowly [MEDRANO].
  - Distal ÷ proximal diameter is about 0.46 for the LAD, 0.53 for the LCX and 0.77 for the RCA (derived from [CT-REF]).
  - A child branch is always narrower than its parent [DODGE1992].
  - Check: COR-20.
- **Tortuosity:** defined as at least 3 bends of 45° or more on one trunk. It is present in 39% and is more common in women [TORT]. Normal vessels are smoothly curved, not straight.

### 5.8 Epicardial fat (EAT)

- The main trunks run in the AV and IV grooves, **embedded in EAT** under the visceral pericardium. No fascia separates the fat from the adventitia [EAT-REV].
- EAT is about 20% of heart mass. Mean thickness is about 7.3 mm in men and 6.8 mm in women [EAT-IMG].
- A bridged segment is surrounded by myocardium with no fat [EAT-REV].
- The CT pericoronary-fat convention is one vessel diameter around the vessel: 10–50 mm from the ostium for the RCA, and the first 40 mm for the LAD and LCX [PCAT].
- Check: COR-21.

### 5.9 SCCT 18-segment model

CardioTwin uses the **SCCT 2014** table [SCCT2014], adapted from AHA/Austen 1975. The **2026 SCCT update**
[SCCT2026] replaced the 2014 document and incorporates CAD-RADS 2.0 [CADRADS2]. Its full text was not reviewed, so
re-check the numbering against it. The **SCCT 2021** document [SCCT2021] is a consensus on clinical use and does not
redefine segments.

| # | Code | Segment | Start → end (SCCT 2014, paraphrased) | CardioTwin node |
| --- | --- | --- | --- | --- |
| 1 | pRCA | Proximal RCA | RCA ostium → half the distance to the acute margin | `Coronary_RCA` |
| 2 | mRCA | Mid RCA | End of pRCA → acute margin | `Coronary_RCA` |
| 3 | dRCA | Distal RCA | End of mRCA → origin of the PDA | `Coronary_RCA` |
| 4 | R-PDA | PDA from RCA | Crux → end, in the posterior IV groove | `Coronary_RCA_PDA` |
| 5 | LM | Left main | LM ostium → LAD/LCX division | `Coronary_LM` |
| 6 | pLAD | Proximal LAD | End of LM → first large septal or D1 (> 1.5 mm), whichever comes first | `Coronary_LAD` |
| 7 | mLAD | Mid LAD | End of pLAD → **half the distance to the apex** | `Coronary_LAD` |
| 8 | dLAD | Distal LAD | End of mLAD → end of the LAD | `Coronary_LAD` |
| 9 | D1 | First diagonal | – | `Coronary_LAD` (branch) |
| 10 | D2 | Second diagonal | – | `Coronary_LAD` (branch) |
| 11 | pCx | Proximal LCX | End of LM → origin of OM1 | `Coronary_LCX` |
| 12 | OM1 | First obtuse marginal | Crosses the lateral LV wall | `Coronary_LCX` (branch) |
| 13 | LCx | Mid-distal LCX | In the AV groove beyond OM1 → end of the vessel or origin of the L-PDA | `Coronary_LCX` |
| 14 | OM2 | Second obtuse marginal | – | `Coronary_LCX` (branch) |
| 15 | L-PDA | PDA from LCX | Left dominance only | not modelled |
| 16 | R-PLB | Posterolateral branch from RCA | Past the crux | `Coronary_RCA_PL` |
| 17 | RI | Ramus intermedius | From the LM between LAD and LCX (trifurcation) | not modelled |
| 18 | L-PLB | Posterolateral branch from LCX | Left dominance | not modelled |

- **Not numbered by SCCT:**
  - Septals: `Coronary_LAD_Septal` and `Coronary_RCA_Septal`.
  - Acute marginal / RV branches: `Coronary_RCA_Marginal`.
  - Conus and SA-nodal branches.
  - These carry `_SEGMENT = 0`. SCCT allows extra names such as D3 or R-PDA2 [SCCT2014].
- **Note:** CONTRACTS §7.1 gives an example mid-LAD definition that ends "at D2 / half-way to the apex". SCCT 2014 ends segment 7 at **half the distance to the apex**, not at D2.
- Check: COR-22 (label sets per node, ordering along the trunk, and boundaries).

### 5.10 AHA 17-segment model and coronary territories

- **Rings:** basal (mitral annulus to papillary tips), mid (papillary length) and apical (below the papillary muscles). The basal and mid rings each have six 60° sectors; the apical ring has four 90° sectors; segment 17 is the apical cap [AHA2002], [RP-SEG]. By mass the rings are about 35 / 35 / 30% [SEGMASS].
- **Standard territories** [AHA2002]:

  | Artery | Segments |
  | --- | --- |
  | LAD | 1 basal anterior, 2 basal anteroseptal, 7 mid anterior, 8 mid anteroseptal, 13 apical anterior, 14 apical septal, 17 apex |
  | RCA (when dominant) | 3 basal inferoseptal, 4 basal inferior, 9 mid inferoseptal, 10 mid inferior, 15 apical inferior |
  | LCX | 5 basal inferolateral, 6 basal anterolateral, 11 mid inferolateral, 12 mid anterolateral, 16 apical lateral |

  The apex (segment 17) is the most variable and can be supplied by any of the three.
- **How reliable the standard map is** (CMR after single-vessel STEMI, n = 93) [ORTIZ2008]:
  - 23% of infarcted segments did not match it.
  - Segments **2, 7, 8 and 13 were 100% specific for the LAD**. Segment 6 was 98% specific for the LCX, segment 5 95% LCX, and segment 4 93% RCA.
  - Segments 12 and 16 were often LAD territory, and segment 15 was LAD or LCX territory in 67%.
  - Checks: COR-23, COR-24; COR-25 (the right-ventricular free wall is RCA territory apart from a strip beside the anterior interventricular groove, which the LAD's RV branches supply).
- **Share of LV mass (CT):** LAD about 42.5%, LCX about 28.8%, RCA about 26.4% [VESSELMASS]. This was read from a search summary only.
- **CardioTwin:** `COLOR_0` on the heart walls holds soft territory weights (R = LAD, G = LCX, B = RCA). It is an approximation, not a lesion map (CONTRACTS §6.2).

---

## 6. Cardiac veins

### 6.1 Overview

- **Two systems** [SP-VEINS], [RP-VEINS]:
  - The **greater** system: the CS and its tributaries, plus the anterior cardiac veins.
  - The **lesser** system: the Thebesian veins.
- **Share of myocardial venous return:** the CS about 55%, anterior cardiac veins about 35% and Thebesian veins about 10% [SP-CS]. Other sources give the greater system about 3/4 [SP-VEINS], and the Thebesian veins up to 30% [SP-THEB].
- The myocardium has at least twice as many veins as arteries [VHL].
- **Topology:** one tree drains through the CS ostium into the RA. Only the anterior cardiac veins, the right marginal vein and (sometimes) the small cardiac vein open into the RA separately. No cardiac vein drains into the left heart, apart from the rare unroofed CS [SP-VEINS], [RP-CS]. Checks: VEN-01 (presence), VEN-10 (topology and epicardial layer), VEN-12 (the CS and anterior cardiac veins open flush into the RA wall; distal tips thin to ≤ 0.8 mm on the epicardium), COR-26 (the crux, the CS ostium and the MCV junction lie within 15 mm of each other).

### 6.2 Coronary sinus (CS)

| Property | Value | Source | Check |
| --- | --- | --- | --- |
| Location | Posterior (diaphragmatic) part of the left AV groove, on the inferior side of the LA | [SP-CS], [RP-CS], [KH-CS] | VEN-04 |
| Start | Where the GCV meets the oblique vein of Marshall, usually marked by the valve of Vieussens | [SP-CS], [VHL] | – |
| Length (Vieussens to ostium) | 3–5 cm; CT 30 mm (21–40); cadaver 28 mm (20–38); 30–50 mm in 75% | [SP-CS], [HABIB2009], [VEN-CAD], [CS-CTMR] | VEN-09 |
| "CS length" in mitral-annuloplasty papers (ostium to AIV, so it includes the GCV) | 108.9 ± 18 mm; 110.1 ± 16.6 mm in controls | [EJCTS-CS], [ROTT2022] | VEN-09 |
| Diameter | About 10 mm; over 12 mm is dilated. CT 9 mm (4–14). Proximal 13.8 ± 5.2 mm, falling to 7.5 ± 1.4 mm at 5 cm | [CS-CTMR], [HABIB2009], [VEN-MORPH] | VEN-08 |
| Ostium | Oval: superior–inferior 11.7 ± 2.1 × front–back 9.0 ± 2.0 mm (CT, n = 102). Range 5–15 mm | [CT256], [HABIB2009], [KOCH2017], [THEB-VALVE] | VEN-08 |
| Ostium position | Posteroinferior RA: medial to and in front of the IVC orifice, in front of the Eustachian ridge, behind the tricuspid annulus and above the septal leaflet. It forms the base of Koch's triangle (base 18.5 ± 4.0 mm, height 16.0 ± 3.7 mm) | [SP-CS], [CS-CTMR], [HABIB2009], [KOCH2017] | VEN-05 |
| Thebesian valve | Present in 82.1%; height 5.8 ± 3.0 mm; covers the whole ostium in 2.6% | [THEB-VALVE] | – |
| Relation to the mitral annulus (MA) | On the atrial side of the MA in 93.1%. Parallel to it in 88%. Minimum CS–MA distance 5.1 ± 2.9 mm (another method gives 14.2 ± 3.6 mm) | [CT256], [EJCTS-CS], [ROTT2022] | VEN-04 |
| Relation to the LCX | The LCX lies between the CS and the MA in 68% [TOPS2007], 77% [SORGENTE2008] and 80% [CHOURE2006]. The LCX is closer to the MA in 74.6% (n = 320) [MLYNARSKI]. Where they run parallel the gap is 3.3 ± 1 mm | [EJCTS-CS] | VEN-06 |

### 6.3 Great cardiac vein (GCV) and anterior interventricular vein (AIV)

- **Course** [KH-GCV], [SP-VEINS]. Check: VEN-02.
  1. Starts near the apex.
  2. Ascends in the **anterior IV groove** with the LAD, where it is called the AIV.
  3. At the LM bifurcation, turns sharply left into the **left AV groove** beside the LCX.
  4. Passes **below the left auricle**.
  5. Becomes the CS once the vein of Marshall joins it.
- It is the longest cardiac vein [VHL].
- **Side relative to the LAD:** usually on the **left (LV) side** of the LAD [KH-LAD]. It crosses the LAD in 29.4% [CT256].
- **Size:** the AIV is about the same calibre as its artery and is seen in about 100% on CT [HABIB2009].
- **Triangle of Brocq and Mouchet:** the GCV, proximal LAD and proximal LCX form a closed triangle in 87–98% [GCV2022]. Inside it the vein is superficial in about 61% [SD-GCV] (secondary excerpt). Check: VEN-07.
- **Diameters:**
  - GCV on CT: 5.6 ± 1.3, 5.99 ± 1.02 and 5.6 ± 1.6 mm. The cadaver value is 2.76 mm because the vessel collapses [GCV2022].
  - AIV: 3.9 ± 1.3 mm proximally, falling to 2.4 ± 0.6 mm at 5 cm [VEN-MORPH].
- **Distance to an artery:** the vein is within 5 mm of an epicardial artery at 74% of mapped GCV sites [DEBAKEY].
- **Fat under the AIV:** 4.2 ± 2.8 mm thick [VEN-MORPH].

### 6.4 Tributaries

| Vein | Course | Prevalence | Joins at (arc length from the CS ostium) | Ostium ⌀ / take-off angle | Source |
| --- | --- | --- | --- | --- | --- |
| Middle cardiac vein (MCV) | **Posterior IV groove with the PDA**, from the apex to the CS near its termination | Usual position in 98%; separate RA ostium in 2.8% | 10.6 ± 4.0 mm (range 1–21) | 4.8 ± 1.0 mm / 71 ± 17° | [SP-VEINS], [HABIB2009], [CT256], [VEN-MORPH] |
| Posterior vein of the LV (PVLV) | Inferolateral LV, between the MCV and the left marginal vein | 77.5% (CT) | 27.8 ± 9.3 mm (range 14–100) | 3.1–4.0 mm / 103–109° | [CT256], [VEN-MORPH], [VEN-CAD] |
| Left marginal vein (LMV) | Along the obtuse margin with an OM; crosses the LCX or an OM in 82.4% | 66.7% (CT) | 57.3 ± 15.1 mm (range 41–113) | 2.7–3.2 mm / 110–116° | [CT256], [VEN-MORPH] |
| Oblique vein of Marshall | Runs down the posterior LA between the LA appendage and the left pulmonary veins | 87% (seen on CT in only 6.9%) | 30.9 ± 10.2 mm; 2.0 ± 1.9 mm from the Vieussens valve | 1.2 mm | [MARSHALL2007], [CT256] |
| Valve of Vieussens | At the GCV–CS junction, 1–3 flimsy cusps | 74% (n = 23) | 24.4 ± 5.8 mm (CT); 27.3 ± 9.5 mm (autopsy) | – | [MARSHALL2007], [VIEUSSENS2019] |
| Small cardiac vein (SCV) | Right AV groove with the RCA, round to the diaphragmatic surface | Tiny or absent in about 60%; seen on CT in 27.5% | Near the ostium, or straight into the RA (about 50%) | small | [KH-SCV], [CT256] |
| Anterior cardiac veins | 2–5 veins across the anterior RV that cross the right AV groove, usually **deep to the RCA**, and drain **directly into the RA** | Constant | – (bypass the CS) | small | [SP-CS], [KH-ACV], [KH-BLOOD] |
| Thebesian veins | Open directly into every chamber, mostly the RA | Constant | – | about 0.5 mm (sub-resolution) | [SP-THEB], [RP-VEINS] |

- **Order from the ostium:** MCV < {PVLV, Vieussens / Marshall} < LMV < the AIV turn at 67–164 mm [VEN-CAD], [VEN-MORPH]. Check: VEN-09.
- **Calibre** grows toward the ostium: distal AIV < proximal AIV < GCV < CS ≤ ostium. The CS is the largest cardiac vein [HABIB2009], [VEN-MORPH]. Check: VEN-08.
- **Apical loop:** the GCV and MCV join at the apex in 36.7% [MCV-MORPH].

### 6.5 Which vein runs with which artery

| Vein | Companion artery | Groove / surface | Side and depth | Typical separation | Check |
| --- | --- | --- | --- | --- | --- |
| AIV → GCV | LAD, then LCX | Anterior IV groove, then left AV groove | LV side of the LAD; crosses it in 29% | Same groove; ≤ 5 mm in 74% | VEN-02, VEN-07 |
| CS | Distal LCX | Posterior left AV groove | Atrial side of the MA; the LCX usually lies between the CS and the MA | 3.3 ± 1 mm when parallel | VEN-04, VEN-06 |
| MCV | PDA | Posterior IV groove | Alongside | Same groove | VEN-03 |
| PVLV | R-PLB / LCX posterolateral branches | Inferolateral LV | Crosses an LCX marginal in 33% | – | VEN-09 |
| LMV | Obtuse marginal | Obtuse margin | Crosses the LCX or an OM in 82% | – | VEN-09 |
| SCV | RCA / acute marginal | Right AV groove | Alongside | – | VEN-11 |
| Anterior cardiac veins | Cross the RCA | Anterior RV | Usually deep to the RCA | – | VEN-11 |

Sources: [CT256], [KH-GCV], [KH-LAD], [DEBAKEY], [TOPS2007], [EJCTS-CS], [SP-VEINS], [KH-ACV].

---

## 7. Colour conventions

| Structures | Convention | Hue (HSV) | Source | Check |
| --- | --- | --- | --- | --- |
| Aorta and coronary arteries (systemic arteries, oxygenated) | Red | 345°–15° | [LT-INTRO] | COL-01 |
| SVC, IVC and cardiac veins (systemic veins, deoxygenated) | Blue | 200°–250° | [LT-INTRO] | COL-02 |
| Pulmonary trunk and arteries | **Blue** (they carry deoxygenated blood) | 200°–250° | [LT-INTRO], [KH-PAPV] | COL-03 |
| Pulmonary veins | **Red** (they carry oxygenated blood) | 345°–15° | [LT-INTRO], [KH-PAPV] | COL-03 |

**CardioTwin rules:**

- The risk colour ramp may recolour **only** the `Coronary_*` targets.
- Veins and great vessels keep the colours above in every mode, so they can never be mistaken for a risk overlay.
- Clinical ("clay") mode is achromatic by design (CONTRACTS §7.1).
- The build's placeholder materials (`MATERIAL_LOOKS` in `anatomy/blender/build_anatomy.py`) already follow this table.

---

## 8. Common variants

| Variant | Prevalence | Model default | Source |
| --- | --- | --- | --- |
| Coronary dominance: right / left / co-dominant | ≈ 85 / 8 / 7% | Right | [WU2024] |
| Ramus intermedius (trifurcation) | 15–32% | Absent | [RP-RI], [NEI2023] |
| Separate conus ostium ("third coronary") | ≈ 40–50% | Optional | [CONAL], [RP-RCA] |
| SA-nodal artery from the RCA / LCX | 68% / 22% | From the RCA (not modelled) | [SAN] |
| AV-nodal artery from the RCA | 82% | From the RCA (not modelled) | [AVN] |
| LAD wrapping the apex | 73–78% | Allowed | [WRAP], [WRAP-REV] |
| Myocardial bridge | 19% pooled (82% on the LAD) | Absent; declare it if modelled | [BRIDGE] |
| Shepherd's crook RCA | ≈ 5% | Absent | [RP-SHEP] |
| Ostium above the STJ | ≈ 22% | Below or at the STJ | [PCR-ROOT] |
| Coronary tortuosity | 39% | Gentle curvature | [TORT] |
| Bovine arch / left vertebral from the arch / aberrant right subclavian | 13.6% / 2.8% / 0.5–1.8% | Standard three branches | [ARCH-VAR] |
| Pulmonary veins: left common trunk / right middle vein | 15–27% / 19–26% | 2 + 2 | [PV-VAR-BMC], [PV-VAR-RG] |
| Persistent left SVC (dilated CS) | 0.3–0.5% | Absent | [PLSVC] |
| Vein of Marshall / valve of Vieussens / Thebesian valve | 87% / 74% / 82% | Not modelled (sub-resolution) | [MARSHALL2007], [THEB-VALVE] |
| MCV with a separate RA ostium | 2.8% | Joins the CS | [HABIB2009] |
| SCV absent or tiny | ≈ 60% | Optional | [KH-SCV] |
| PVLV / LMV present | 77.5% / 66.7% | Expected | [CT256] |

---

## 9. Editorial decisions (resolved contradictions)

| Topic | Conflicting values | Adopted | Why |
| --- | --- | --- | --- |
| Dominance prevalence | 70/10/20 [RP-RCA]; 85/8/7 [RP-DOM]; 91/9 [CONFIRM]; 89.7/8/2.3 [DOM-CCTA] | **85 / 8 / 7** | A 2024 AHA-journal review [WU2024] outranks an encyclopaedia page. The large CCTA cohorts agree within the spread of co-dominance definitions. |
| Ascending / descending aortic calibre | Dossier values 36.6/32.5 and 28.9/25.4 mm | **33 ± 4 (≤ 41) and 24 ± 3 (≤ 30) mm** | Re-checked against the primary abstract [WOLAK2008] (n = 4,039, outer wall, PA-bifurcation level). |
| Heart depth | 6 cm (excised specimen) vs in-situ CT / radiograph | Depth not tested | Specimen dimensions describe an empty heart. The tests use the long axis (12 cm), the transverse diameter and the CTR [BRAKO2017]. |
| LM length | 5–10 mm [RP-LM] vs CT means 9–10.5 mm | Typical 5–15, accept 2–25 mm | CT cohorts [MEDRANO], [NEI2023] outrank the encyclopaedia. |
| LM diameter | 3.5 (CT atlas) vs 4.5 mm (angiography / IVUS) | Typical 3.5–4.5, accept 2.7–5.5 mm | Differences in method; both are in-vivo. |
| Main-PA diameter | "About 3 cm" [IMAIOS-PT] vs 90th percentile 29 / 27 mm [FRAM-PA] | ≤ 0.29 u (men), ≤ 0.27 u (women) | The population CT cohort outranks the atlas. |
| CS length | 3–5 cm vs 110 mm | Both, with different definitions | 110 mm is ostium → AIV (CS + GCV), a mitral-annuloplasty convention [EJCTS-CS], [ROTT2022]. |
| LCX between the CS and MA | 68 / 77 / 80% | "About 7 in 10" (default phenotype) | Three independent CT series [TOPS2007], [SORGENTE2008], [CHOURE2006]. |
| Venous return shares | 55/35/10% vs 3/4 : 1/4 | Reported as ranges | Not modelled. |
| Height of the MV vs the TV | Both project to CC4 [KH-SURF] | MV annulus at or above the TV annulus (±0.05 u); TV slightly more apical | The MV is posterosuperior to the TV [KH-VALVES], and the TV hinge sits apically [EBSTEIN]. |
| Mid-LAD end | CONTRACTS §7.1 example says "D2 / half-way" | **Half the distance to the apex** | SCCT 2014 Appendix table [SCCT2014]. |
| Which SCCT version | 2014 / 2021 / 2026 | 2014 numbering | 2021 [SCCT2021] is not a segmentation document. The 2026 update [SCCT2026] was not reviewed in full. |

---

## 10. Snapshot of the current asset (2026-09-30)

These values were measured read-only from `vessels.json`, `manifest.json` and `anatomy/build/cardiotwin_anatomy.raw.glb`
while other agents were rebuilding. Re-run `reference_checks.yaml` after each rebuild.

| Finding | Value | Reference | Check |
| --- | --- | --- | --- |
| LCX trunk too long, and it leaves the AV groove | 136 mm; the trunk goes back to z ≈ −0.32, then forward to z ≈ +0.21 near the apex, so it looks like an OM | 41–108 mm (typically 50–80), in the AV groove | COR-10, COR-11 |
| LAD : LCX length ratio | 0.92 | ≈ 1.65 (1.2–2.5) | COR-11 |
| RCA trunk | 170 mm in total. The PDA leaves at 133 mm, which is in range; the last 37 mm should be the R-PLB (segment 16) | 120–140 mm to the crux | COR-13, COR-14 |
| RCA ostium height | 8.3 mm lower in Y than the LM ostium | Usually about 3 mm **higher** above the annulus | COR-02 |
| Proximal RCA | Rises about 10 mm in the first 21 mm | A shepherd's-crook loop is a 5% variant | COR-15 |
| LM / LAD | 8.6 mm / 125 mm; LM ⌀ 3.4–3.6 mm | In range | COR-03, COR-07 |
| LAD–LCX angle | ≈ 54° | 30–130° (typically 63–90°) | COR-05 |
| Midline | `X_mid` = −0.23 u (sternum median X equals the spine centroid X) | – | landmarks |
| Heart-wall vertices left of the midline | 0.64 | 0.60–0.75 | POS-01 |
| Apex lateral distance / frontal tilt | 0.70 u / 27.5° | 0.65–1.05 u / 21–56° | POS-05, POS-03 |
| SVC mesh | Y 0.48–0.83, only 0.35 u long | About 0.7 u (right CC1 to CC3) | GV-10, GV-11 |
| Cardiac veins | One mesh (14k triangles) with no centrelines | Checks run against the mesh | VEN-* |
| Valve centroids | Mitral 2 mm lower than tricuspid | MV at or above TV (±0.05 u) | VLV-04 |
| Diaphragm domes | Right −0.28 u, left −0.46 u | Right higher | POS-10 |

**Update after realism round 1** (full results: [`anatomy/checks/gap_report.md`](../../anatomy/checks/gap_report.md); what
is synthesised: [`SYNTHESIS.md`](SYNTHESIS.md)):

| Finding | Value now | Check |
| --- | --- | --- |
| LCX trunk | 62 mm in the left AV groove (pCx); the apical run is OM1; LAD : LCX 2.0 | COR-11 pass |
| Aortic root | Synthesised: annulus 23 mm, sinuses 34 mm, STJ 26 mm, ascending 27 mm; `Valve_Aortic` added | GV-02 pass |
| Coronary ostia above the annulus | LM 13 mm, RCA 16 mm | COR-02 pass |
| PA : ascending aorta | 0.83 | GV-08 pass |
| Cardiac veins | One labelled lumen; CS 8.9 mm (ostium 9.6 mm), GCV 4.2 mm; CS 76 % on the atrial side of the mitral hinge; ostium in front of the IVC | VEN-05/06/08 |
| LV territory shares | LAD 42.9 %, LCX 24.8 %, RCA 32.2 %; AHA-17 majority map correct in all segments | COR-24 minor |
| SCCT labels | `_SEGMENT`, `vessels.json` labels and `manifest.segments` present | COR-22 pass |
| Diaphragm domes | Lowered 4 mm (dome order unchanged); heart-diaphragm overlap 1.9 mm | POS-10 |

**Update after realism round 2** (52 PASS / 8 MINOR / 13 FAIL of 73; the coronary tree and the cardiac veins are now
designed on the heart, see [`SYNTHESIS.md`](SYNTHESIS.md)):

| Finding | Value now | Check |
| --- | --- | --- |
| Aorto-mitral continuity | Root moved (3, 10, −10) mm plus a 1 mm fibrous curtain; gap 1.1 mm | VLV-05 pass |
| LM | 17 mm leftwards behind the pulmonary trunk; bifurcation 13.7 mm from the mitral ring; LM–LAD 48°, LAD–LCX 112° | COR-03/04/05 pass |
| RCA | Anterior take-off, in the right AV groove (≤ 12.9 mm from the tricuspid hinge), acute margin at 99 mm, crux at 140 mm, no loop (rise 1.6 mm) | COR-13/14/15 pass |
| Septal perforators | Three from the LAD and three from the PDA, take-off 55–95°, 80–100 % intramyocardial | COR-09 pass |
| Obtuse marginals | OM1 and OM2 (≥ 1.5 mm) run to the apex over the lateral wall | COR-12 pass |
| Calibres | LM 4.15, pLAD 3.47, pRCA 3.25, pLCX 2.95 mm; every segment tapers | COR-20 pass |
| RV free wall | 85 % RCA-dominant; the LAD strip reaches 15 mm (14.6 % beyond, band 10 %) | COR-25 minor |
| Cardiac veins | CS 9.3 mm (ostium 10 mm) 2.1 mm from the tricuspid hinge, MCV joins 9.6 mm from the ostium; LMV and SCV present; GCV 4.6 mm; tips 0.45 mm | VEN-01/05/08/11 pass |
| Coronary sinus course | 70 % atrial to the mitral hinge, 48 % parallel; CS + GCV 197 mm | VEN-04, VEN-09 fail |

**Update after realism round 3** (60 PASS / 8 MINOR / 10 FAIL of 78; 58 / 7 / 8 on the 73 round-2 checks; the valve
apparatus is synthesised and the heart wall has three local corrections, see [`SYNTHESIS.md`](SYNTHESIS.md)):

| Finding | Value now | Check |
| --- | --- | --- |
| Mitral isthmus | Left pulmonary-vein contact ≥ 22.7 mm (median 29.9 mm) from the mitral hinge; LCX 15.5 mm and GCV 8 mm from the nearest pulmonary vein | VEN-14 pass |
| SVC | Joins the lowered right-atrial roof at the right 3rd costal cartilage; 46 mm long (60–80 mm) | GV-10 pass, GV-11 fail |
| Tricuspid offset | Septal hinge 7 mm apical of the anterior mitral hinge (hinge lines); the check's basal-quartile fit reads −6.7 mm | VLV-04 minor |
| LM | 16 mm, Ø 4.15 mm; LM–LAD 64°, LAD–LCX 117°; the pulmonary trunk does not overlie it in the frontal view | COR-03 pass, COR-04/05 minor |
| Septal perforators | Three from the LAD (from 38 mm) and three from the PDA, take-off 44–56°, 71–89 % intramyocardial | COR-09 pass |
| Conus branch | Crosses the anterior infundibulum 11 mm below the pulmonary valve, leftwards | COR-27 pass |
| Vessels on the wall | No coronary or vein sample inside the myocardium; 164 of 1848 samples float 0.6–3 mm (crease crossings, RV dips) | COR-21, VEN-10 pass; VAS-01 fail |
| Lungs / diaphragm | Cardiac impression carved; no heart structure inside a lung or the diaphragm (> 0.5 mm) | POS-09, POS-10 pass |
| RV free wall | 88 % RCA-dominant; 11 % LAD-dominant beyond 15 mm of the LAD (band 10 %) | COR-25 minor |
| Coronary sinus course | Ostium 23 mm from the crux; 58 % atrial to the mitral hinge, 38 % parallel; CS + GCV 156 mm | COR-26, VEN-04 fail, VEN-09 minor |

---

## 11. Sources

Accessed September 2026. **FT** = full text read; **Abs** = abstract only; **Sum** = search summary or secondary excerpt only.

**Standards, guidelines and large reviews**

| Key | Source | Read |
| --- | --- | --- |
| SCCT2014 | [Leipsic J et al. SCCT guidelines for the interpretation and reporting of coronary CTA. J Cardiovasc Comput Tomogr 2014;8:342–358 (Appendix: segment table)][SCCT2014]; journal page: https://www.journalofcardiovascularct.com/article/S1934-5925(14)00165-8/abstract | FT |
| SCCT2021 | [Narula J et al. SCCT 2021 Expert Consensus Document on Coronary CTA. J Cardiovasc Comput Tomogr 2021;15:192–217][SCCT2021] | Sum |
| SCCT2026 | [Interpretation and Reporting of Coronary CTA (2026 Update), SCCT expert consensus][SCCT2026] | Sum |
| CADRADS2 | [CAD-RADS 2.0 (2022) expert consensus][CADRADS2] | Sum |
| AHA2002 | [Cerqueira MD et al. Standardized myocardial segmentation and nomenclature. Circulation 2002;105:539–542][AHA2002] | Sum |
| RP-SEG | [Radiopaedia: cardiac segmentation model][RP-SEG] | FT |
| ORTIZ2008 | [Ortiz-Pérez JT et al. Correspondence between the 17-segment model and coronary anatomy. JACC Cardiovasc Imaging 2008;1:282–293][ORTIZ2008] | FT |
| SEGMASS | [Relative segmental mass in the AHA 17-segment model (Circulation 2012 abstract)][SEGMASS] | Sum |
| VESSELMASS | [Vessel-specific myocardial mass in stable CAD (JAHA)][VESSELMASS] | Sum |
| ASE2015 | [Lang RM et al. ASE/EACVI chamber quantification 2015][ASE2015] | FT |
| WU2024 | [Wu et al. Clinical significance of coronary arterial dominance: a review. JAHA 2024][WU2024] | Sum |

**Coronary arteries**

| Key | Source | Read |
| --- | --- | --- |
| SP-CA | [StatPearls: Anatomy, thorax, heart coronary arteries][SP-CA] | Sum |
| RP-RCA | [Radiopaedia: right coronary artery][RP-RCA] | FT |
| RP-LAD | [Radiopaedia: left anterior descending artery][RP-LAD] | FT |
| RP-LCX | [Radiopaedia: left circumflex artery][RP-LCX] | FT |
| RP-LM | [Radiopaedia: left main coronary artery][RP-LM] | FT |
| RP-RI | [Radiopaedia: ramus intermedius artery][RP-RI] | FT |
| RP-PDA | [Radiopaedia: posterior descending artery][RP-PDA] | FT |
| RP-DOM | [Radiopaedia: coronary arterial dominance][RP-DOM] | FT |
| RP-SHEP | [Radiopaedia: shepherd's crook RCA][RP-SHEP] | FT |
| KH-LAD | [Kenhub: left anterior descending artery][KH-LAD] | FT |
| KH-LCA | [Kenhub: left coronary artery][KH-LCA] | FT |
| KH-RCA | [Kenhub: right coronary artery][KH-RCA] | FT |
| KH-BLOOD | [Kenhub: blood supply of the heart][KH-BLOOD] | FT |
| KH-SULCUS | [Kenhub: coronary sulcus][KH-SULCUS] | FT |
| TMA-VASC | [TeachMeAnatomy: vasculature of the heart][TMA-VASC] | FT |
| VILLA2016 | [Villa AD et al. Coronary artery anomalies overview. World J Radiol 2016][VILLA2016] | FT |
| MEDRANO | [Medrano-Gracia P et al. A computational atlas of normal coronary artery anatomy. EuroIntervention][MEDRANO] | FT |
| NEI2023 | [Left coronary artery morphometry by CTA, North-East India, 2023][NEI2023] | FT |
| IVUS-LM | [IVUS reference dimensions of the left main][IVUS-LM] | Abs |
| DODGE1992 | [Dodge JT et al. Lumen diameter of normal human coronary arteries. Circulation 1992][DODGE1992] | Abs |
| CT-REF | [Coronary dimensions on CTA, athletes vs controls][CT-REF] | FT |
| SEX-DIAM | [Gender-specific coronary diameters on CT coronary angiography (IJCDW)][SEX-DIAM] | FT |
| IND-DIAM | [Coronary artery dimensions in normal Indians][IND-DIAM] | FT |
| TOPS2008 | [Tops LF et al. Aortic root MSCT for TAVI. JACC Cardiovasc Imaging 2008][TOPS2008] | Abs |
| PCR-ROOT | [PCRonline: anatomy of the aortic valvar complex, coronary arteries][PCR-ROOT] | FT |
| IMAIOS-SINUS | [IMAIOS: aortic sinuses][IMAIOS-SINUS] | FT |
| CONFIRM | [Gebhard C et al. Coronary dominance on CCTA (CONFIRM registry)][CONFIRM] | FT |
| DOM-CCTA | [Coronary dominance on CCTA, n = 677 (J Clin Med 2026)][DOM-CCTA] | Sum |
| DOM-ANGIO | [Coronary dominance prevalence on angiography (J Multidiscip Healthc)][DOM-ANGIO] | Sum |
| WRAP | [LAD wrapping and cardiac mechanics in normal angiograms][WRAP] | FT |
| WRAP-REV | [Wrap-around LAD: case and review][WRAP-REV] | FT |
| BRIDGE | [Hostiuc S et al. Myocardial bridging meta-analysis. J Forensic Sci 2018][BRIDGE] | Sum |
| SAN | [Vikse J et al. SA-nodal artery meta-analysis. PLoS One 2016][SAN] | Abs |
| AVN | [Kuniewicz M et al. AV-nodal artery meta-analysis. Clin Anat 2023][AVN] | Abs |
| CONAL | [Clinical anatomy of the conal artery][CONAL] | Abs |
| SEPTAL | [Anatomy of the septal perforating arteries][SEPTAL] | FT |
| ANGLES | [LM–LAD and LAD–LCX angles on CTA][ANGLES] | FT |
| TORT | [Coronary tortuosity: definition and prevalence (PLoS One)][TORT] | Sum |
| EAT-REV | [Talman AH et al. Epicardial adipose tissue review. Cardiovasc Diagn Ther][EAT-REV] | FT |
| EAT-IMG | [Cardiac adipose tissue imaging review, Front Imaging 2025][EAT-IMG] | FT |
| PCAT | [Automated pericoronary adipose tissue measurement on CTA (arXiv 2311.13100)][PCAT] | FT |
| TOPS2007 | [Tops LF et al. Coronary sinus vs mitral annulus and circumflex. Circulation 2007][TOPS2007] | Abs |

**Cardiac veins**

| Key | Source | Read |
| --- | --- | --- |
| HABIB2009 | [Habib A et al. Anatomy of the coronary sinus venous system for the electrophysiologist. Europace 2009][HABIB2009] | FT |
| CT256 | [256-slice CT of the coronary venous system, n = 102 (PLoS One 2014)][CT256] | FT |
| VEN-MORPH | [Morphometry of coronary veins and subvenous epicardial fat][VEN-MORPH] | FT |
| VEN-CAD | [Cadaveric study of coronary venous tributaries][VEN-CAD] | FT |
| SP-VEINS | [StatPearls: heart veins][SP-VEINS] | FT |
| SP-CS | [StatPearls: coronary sinus][SP-CS] | FT |
| SP-THEB | [StatPearls: Thebesian veins][SP-THEB] | FT |
| RP-VEINS | [Radiopaedia: coronary veins][RP-VEINS] | FT |
| RP-CS | [Radiopaedia: coronary sinus][RP-CS] | FT |
| THEB-VALVE | [Thebesian valve variations, n = 273 (Europace 2015)][THEB-VALVE] | Abs |
| GCV2022 | [Great cardiac vein morphometry, n = 52][GCV2022] | FT |
| SD-GCV | [ScienceDirect Topics: great cardiac vein][SD-GCV] | Sum |
| KOCH2017 | [Geometry of Koch's triangle, n = 120 (Europace 2017)][KOCH2017] | Abs |
| VHL | [Visible Heart Lab, University of Minnesota: coronary venous anatomy][VHL] | FT |
| CS-CTMR | [CT/MRI of the coronary sinus: anatomic variants][CS-CTMR] | FT |
| ROTT2022 | [Rottländer D et al. CS and mitral annulus in functional MR (Front Cardiovasc Med 2022)][ROTT2022] | FT |
| EJCTS-CS | [CS anatomy in normal vs insufficient mitral valves (EJCTS)][EJCTS-CS] | Abs |
| SORGENTE2008 | [Sorgente A et al. LA/LV volumes and the CS–MA relation][SORGENTE2008] | FT |
| CHOURE2006 | [Choure AJ et al. JACC 2006 (CS, MA and LCX)][CHOURE2006] | Abs |
| KH-CS | [Kenhub: coronary sinus][KH-CS] | FT |
| MLYNARSKI | [Młynarski R et al. CS–LCX–MA relation, n = 320 (Cardiol J)][MLYNARSKI] | Sum |
| PLSVC | [Persistent left SVC review][PLSVC] | FT |
| KH-GCV | [Kenhub: great cardiac vein][KH-GCV] | FT |
| DEBAKEY | [Coronary venous mapping and ablation (Methodist DeBakey CV J)][DEBAKEY] | FT |
| VIEUSSENS2019 | [Żabówka A et al. Vieussens valve at autopsy and on CT (J Cardiovasc Electrophysiol 2019)][VIEUSSENS2019] | Abs |
| MARSHALL2007 | [Marshall vein anatomy, n = 23 (Europace 2007)][MARSHALL2007] | Abs |
| MCV-MORPH | [Middle cardiac vein morphology, n = 30][MCV-MORPH] | FT |
| KH-SCV | [Kenhub: small cardiac vein][KH-SCV] | FT |
| KH-ACV | [Kenhub: anterior cardiac veins][KH-ACV] | FT |

**Position, chambers, great vessels, valves, thorax and colour**

| Key | Source | Read |
| --- | --- | --- |
| KH-SURF | [Kenhub: surface projections of the heart][KH-SURF] | FT |
| KH-APEX | [Kenhub: apex of the heart][KH-APEX] | Sum |
| GPN-PERI | [GPnotebook: surface anatomy of the fibrous pericardium][GPN-PERI] | FT |
| LT-POS | [Textbook of Cardiology (LibreTexts): position of the heart][LT-POS] | FT |
| TMA-BORD | [TeachMeAnatomy: borders, sinuses and sulci of the heart][TMA-BORD] | FT |
| CV-SIZE | [The Common Vein: size of the heart][CV-SIZE] | FT |
| LT-SIZE | [LibreTexts anatomy lab: location, size and shape of the heart][LT-SIZE] | FT |
| BJC2015 | [Cardiac orientation: anatomical vs electrical axis (Br J Cardiol 2015)][BJC2015] | FT |
| RP-CTR | [Radiopaedia: cardiothoracic ratio][RP-CTR] | FT |
| BRAKO2017 | [Brakohiapa EK et al. CTR and transverse cardiac diameter, n = 1,047 (Pan Afr Med J 2017)][BRAKO2017] | FT |
| SP-MED | [StatPearls: mediastinum][SP-MED] | FT |
| RADASSIST | [Radiology Assistant: cardiac anatomy][RADASSIST] | FT |
| SA-LEVEL | [AnatomyZone: sternal angle][SA-LEVEL] | FT |
| KH-AORTA | [Kenhub: aorta][KH-AORTA] | FT |
| RP-ARCH | [Radiopaedia: aortic arch][RP-ARCH] | FT |
| AA-AORTA | [Anatomy Atlases: topography of the aorta][AA-AORTA] | FT |
| WOLAK2008 | [Wolak A et al. Aortic size by non-contrast cardiac CT, n = 4,039. JACC Cardiovasc Imaging 2008][WOLAK2008] | Abs |
| IMAIOS-SOV | [IMAIOS: sinuses of Valsalva diameter][IMAIOS-SOV] | FT |
| IMAIOS-STJ | [IMAIOS: sinotubular junction diameter][IMAIOS-STJ] | FT |
| ARCH-VAR | [Aortic arch branching variants meta-analysis (J Vasc Surg)][ARCH-VAR] | Abs |
| KH-PT | [Kenhub: pulmonary trunk][KH-PT] | FT |
| IMAIOS-PT | [IMAIOS: pulmonary trunk][IMAIOS-PT] | FT |
| PA-BIF | [Vertebral level of the pulmonary-trunk bifurcation by sex (figure; low grade)][PA-BIF] | Sum |
| FRAM-PA | [Truong QA et al. Framingham CT reference values for PA dimensions (Circ Cardiovasc Imaging 2012)][FRAM-PA] | Abs |
| TMA-SVC | [TeachMeAnatomy: superior vena cava][TMA-SVC] | FT |
| SP-IVC | [StatPearls: inferior vena cava][SP-IVC] | FT |
| KH-IVC | [Kenhub: inferior vena cava][KH-IVC] | FT |
| KH-PV | [Kenhub: pulmonary veins][KH-PV] | FT |
| KH-PAPV | [Kenhub: pulmonary arteries and veins][KH-PAPV] | FT |
| PV-VAR-BMC | [Pulmonary vein variants (BMC Cardiovasc Disord 2018)][PV-VAR-BMC] | Abs |
| PV-VAR-SRA | [Pulmonary vein variants (Surg Radiol Anat 2019)][PV-VAR-SRA] | Abs |
| PV-VAR-RG | [Pulmonary vein anatomy (RadioGraphics 2017)][PV-VAR-RG] | Abs |
| PV-DIAM | [Pulmonary vein ostial diameters on CT (Radiology 2005)][PV-DIAM] | Abs |
| KH-VALVES | [Kenhub: heart valves][KH-VALVES] | FT |
| KH-SKEL | [Kenhub: cardiac skeleton][KH-SKEL] | FT |
| AO-MITRAL | [Aorto-mitral angle on CT][AO-MITRAL] | FT |
| HORIZ-AO | [TAVI and the horizontal aorta (EuroIntervention)][HORIZ-AO] | FT |
| EBSTEIN | [Apical displacement index of the tricuspid valve (Circulation)][EBSTEIN] | Abs |
| ANN-CMR | [Mitral and tricuspid annulus dimensions by CMR (JCMR 2020)][ANN-CMR] | Abs |
| ANN-JACC | [Tricuspid annulus dimensions (JACC Cardiovasc Imaging 2017)][ANN-JACC] | Abs |
| ANN-PATENT | [Aortic and pulmonary annulus range, patent background (low grade)][ANN-PATENT] | Sum |
| TMA-PERI | [TeachMeAnatomy: pericardium][TMA-PERI] | FT |
| PERI-CT | [Pericardial thickness on CT (Radiology)][PERI-CT] | Abs |
| KH-PERI | [Kenhub: the pericardium][KH-PERI] | FT |
| IMAIOS-NOTCH | [IMAIOS: cardiac notch of the left lung][IMAIOS-NOTCH] | FT |
| DIAPH | [Dartmouth Human Anatomy: diaphragm levels][DIAPH] | FT |
| LEMOLA2004 | [Lemola K et al. CT of the LA and oesophagus. Circulation 2004][LEMOLA2004] | Abs |
| SANCHEZ2005 | [Sánchez-Quintana D et al. Oesophagus and LA wall. Circulation 2005][SANCHEZ2005] | Abs |
| IMAIOS-OES | [IMAIOS: thoracic oesophagus][IMAIOS-OES] | FT |
| KH-CARINA | [Kenhub: carina of trachea][KH-CARINA] | FT |
| CARINA-ANGLE | [Subcarinal angle on CT][CARINA-ANGLE] | Abs |
| LT-INTRO | [LibreTexts anatomy lab manual: cardiovascular introduction (colour coding)][LT-INTRO] | FT |

[SCCT2014]: https://cdn.ymaws.com/scct.org/resource/resmgr/Docs/Fellows&Residents_of_SCCT/Interpretation_guidelines.pdf
[SCCT2021]: https://www.sciencedirect.com/science/article/pii/S1934592520304731
[SCCT2026]: https://www.sciencedirect.com/science/article/pii/S1934592526004806
[CADRADS2]: https://pubs.rsna.org/doi/full/10.1148/ryct.220183
[AHA2002]: https://www.ahajournals.org/doi/10.1161/hc0402.102975
[RP-SEG]: https://radiopaedia.org/articles/cardiac-segmentation-model-1
[ORTIZ2008]: https://www.jacc.org/doi/10.1016/j.jcmg.2008.01.014
[SEGMASS]: https://www.ahajournals.org/doi/abs/10.1161/circ.126.suppl_21.A15074
[VESSELMASS]: https://www.ahajournals.org/doi/10.1161/JAHA.124.039013
[ASE2015]: https://www.asecho.org/wp-content/uploads/2016/02/2015_ChamberQuantificationREV.pdf
[WU2024]: https://pubmed.ncbi.nlm.nih.gov/38639360/
[SP-CA]: https://www.ncbi.nlm.nih.gov/books/NBK534790/
[RP-RCA]: https://radiopaedia.org/articles/right-coronary-artery
[RP-LAD]: https://radiopaedia.org/articles/left-anterior-descending-artery
[RP-LCX]: https://radiopaedia.org/articles/left-circumflex-artery
[RP-LM]: https://radiopaedia.org/articles/left-main-coronary-artery
[RP-RI]: https://radiopaedia.org/articles/ramus-intermedius-artery
[RP-PDA]: https://radiopaedia.org/articles/posterior-descending-artery
[RP-DOM]: https://radiopaedia.org/articles/coronary-arterial-dominance
[RP-SHEP]: https://radiopaedia.org/articles/shepherds-crook-right-coronary-artery
[KH-LAD]: https://www.kenhub.com/en/library/anatomy/left-anterior-descending-artery-lad
[KH-LCA]: https://www.kenhub.com/en/library/anatomy/left-coronary-artery
[KH-RCA]: https://www.kenhub.com/en/library/anatomy/right-coronary-artery
[KH-BLOOD]: https://www.kenhub.com/en/library/anatomy/blood-supply-of-the-heart
[KH-SULCUS]: https://www.kenhub.com/en/library/anatomy/coronary-sulcus
[TMA-VASC]: https://teachmeanatomy.info/thorax/organs/heart/heart-vasculature/
[VILLA2016]: https://www.wjgnet.com/1949-8470/full/v8/i6/537.htm
[MEDRANO]: https://eurointervention.pcronline.com/article/a-computational-atlas-of-normal-coronary-artery-anatomy
[NEI2023]: https://pmc.ncbi.nlm.nih.gov/articles/PMC10566226/
[IVUS-LM]: https://pubmed.ncbi.nlm.nih.gov/30260080
[DODGE1992]: https://pubmed.ncbi.nlm.nih.gov/1535570/
[CT-REF]: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8620029/
[SEX-DIAM]: https://ijcdw.org/gender-specific-coronary-artery-diameters-in-ct-coronary-angiogram-a-comparative-study-in-female-and-male-population/
[IND-DIAM]: https://pmc.ncbi.nlm.nih.gov/articles/PMC5560873/
[TOPS2008]: https://www.sciencedirect.com/science/article/pii/S1936878X08000314
[PCR-ROOT]: https://www.pcronline.com/Cases-resources-images/Tools-and-Practice/Anatomy-of-the-aortic-valvar-complex/Coronary-arteries
[IMAIOS-SINUS]: https://www.imaios.com/en/e-anatomy/anatomical-structures/aortic-sinuses-14356172
[CONFIRM]: https://pmc.ncbi.nlm.nih.gov/articles/PMC4505791
[DOM-CCTA]: https://pmc.ncbi.nlm.nih.gov/articles/PMC13363422/
[DOM-ANGIO]: https://www.dovepress.com/correlation-between-coronary-arterial-dominance-and-the-degree-of-coro-peer-reviewed-fulltext-article-JMDH
[WRAP]: https://pmc.ncbi.nlm.nih.gov/articles/PMC7270221/
[WRAP-REV]: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12765196/
[BRIDGE]: https://onlinelibrary.wiley.com/doi/10.1111/1556-4029.13665
[SAN]: https://pubmed.ncbi.nlm.nih.gov/26849441/
[AVN]: https://pubmed.ncbi.nlm.nih.gov/37245092/
[CONAL]: https://pubmed.ncbi.nlm.nih.gov/25255889/
[SEPTAL]: https://pmc.ncbi.nlm.nih.gov/articles/PMC6773898/
[ANGLES]: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6136703/
[TORT]: https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0024232
[EAT-REV]: https://cdt.amegroups.org/article/view/5256/html
[EAT-IMG]: https://www.frontiersin.org/journals/imaging/articles/10.3389/fimag.2025.1694840/full
[PCAT]: https://arxiv.org/abs/2311.13100
[TOPS2007]: https://www.ahajournals.org/doi/10.1161/circulationaha.106.677880
[HABIB2009]: https://academic.oup.com/europace/article/11/suppl_5/v15/466150
[CT256]: https://pmc.ncbi.nlm.nih.gov/articles/PMC4121327/
[VEN-MORPH]: https://pmc.ncbi.nlm.nih.gov/articles/PMC7793918/
[VEN-CAD]: https://pmc.ncbi.nlm.nih.gov/articles/PMC4695857/
[SP-VEINS]: https://www.ncbi.nlm.nih.gov/books/NBK549786/
[SP-CS]: https://www.ncbi.nlm.nih.gov/books/NBK557566/
[SP-THEB]: https://www.ncbi.nlm.nih.gov/books/NBK541040/
[RP-VEINS]: https://radiopaedia.org/articles/coronary-veins
[RP-CS]: https://radiopaedia.org/articles/coronary-sinus
[THEB-VALVE]: https://academic.oup.com/europace/article/17/6/921/2398688
[GCV2022]: https://pmc.ncbi.nlm.nih.gov/articles/PMC8948444/
[SD-GCV]: https://www.sciencedirect.com/topics/medicine-and-dentistry/great-cardiac-vein
[KOCH2017]: https://academic.oup.com/europace/article/19/3/452/2952262
[VHL]: https://www.vhlab.umn.edu/atlas/coronary-system-tutorial/coronary-venous-anatomy.shtml
[CS-CTMR]: https://pmc.ncbi.nlm.nih.gov/articles/PMC4195839/
[ROTT2022]: https://www.frontiersin.org/journals/cardiovascular-medicine/articles/10.3389/fcvm.2022.868562/full
[EJCTS-CS]: https://academic.oup.com/ejcts/article/33/4/583/443249
[SORGENTE2008]: https://pmc.ncbi.nlm.nih.gov/articles/PMC2745724/
[CHOURE2006]: https://pubmed.ncbi.nlm.nih.gov/17112981/
[KH-CS]: https://www.kenhub.com/en/library/anatomy/coronary-sinus
[MLYNARSKI]: https://journals.viamedica.pl/cardiology_journal/article/view/CJ.2013.0067/32168
[PLSVC]: https://pmc.ncbi.nlm.nih.gov/articles/PMC7561662/
[KH-GCV]: https://www.kenhub.com/en/library/anatomy/great-cardiac-vein
[DEBAKEY]: https://journal.houstonmethodist.org/articles/10.14797/HUZR1007
[VIEUSSENS2019]: https://onlinelibrary.wiley.com/doi/10.1111/jce.14018
[MARSHALL2007]: https://academic.oup.com/europace/article/9/10/915/497132
[MCV-MORPH]: https://www.ijcap.org/html-article/11567
[KH-SCV]: https://www.kenhub.com/en/library/anatomy/small-cardiac-vein
[KH-ACV]: https://www.kenhub.com/en/library/anatomy/anterior-cardiac-veins
[KH-SURF]: https://www.kenhub.com/en/library/anatomy/surface-projections-of-the-heart
[KH-APEX]: https://www.kenhub.com/en/library/anatomy/apex-of-the-heart
[GPN-PERI]: https://gpnotebook.com/en-GB/pages/cardiovascular-medicine/fibrous-pericardium-anatomy/surface-anatomy-on-thorax
[LT-POS]: https://med.libretexts.org/Bookshelves/Medicine/Textbook_of_Cardiology/01:_Anatomy/1.02:_Position_of_the_Heart
[TMA-BORD]: https://teachmeanatomy.info/thorax/organs/heart/borders-sinuses-sulci/
[CV-SIZE]: https://heart.thecommonvein.net/structure/size/
[LT-SIZE]: https://bio.libretexts.org/Courses/West_Hills_College_-_Lemoore/Human_Anatomy_Laboratory_Manual_(Hartline)/17:_Cardiovascular_System_-_The_Heart/17.02:_Location_Size_and_Shape_of_the_Heart
[BJC2015]: https://bjcardio.co.uk/2015/04/cardiac-orientation-is-there-a-correlation-between-the-anatomical-and-the-electrical-axis-of-the-heart/
[RP-CTR]: https://radiopaedia.org/articles/cardiothoracic-ratio
[BRAKO2017]: https://pmc.ncbi.nlm.nih.gov/articles/PMC5579422/
[SP-MED]: https://www.ncbi.nlm.nih.gov/sites/books/NBK539819/
[RADASSIST]: https://radiologyassistant.nl/cardiovascular/anatomy/cardiac-anatomy
[SA-LEVEL]: https://anatomyzone.com/articles/sternal-angle-2/
[KH-AORTA]: https://www.kenhub.com/en/library/anatomy/aorta
[RP-ARCH]: https://radiopaedia.org/articles/aortic-arch
[AA-AORTA]: https://www.anatomyatlases.org/HumanAnatomy/Topography/Aorta.shtml
[WOLAK2008]: https://pubmed.ncbi.nlm.nih.gov/19356429/
[IMAIOS-SOV]: https://www.imaios.com/en/e-anatomy/anatomical-structures/sinuses-of-valsalva-diameter-1574775432
[IMAIOS-STJ]: https://www.imaios.com/en/e-anatomy/anatomical-structures/sinotubular-junction-diameter-1574775456
[ARCH-VAR]: https://www.sciencedirect.com/science/article/pii/S0741521417317883
[KH-PT]: https://www.kenhub.com/en/library/anatomy/pulmonary-trunk
[IMAIOS-PT]: https://www.imaios.com/en/e-anatomy/anatomical-structures/pulmonary-trunk-1541224300
[PA-BIF]: https://www.researchgate.net/figure/ertebral-level-of-the-pulmonary-trunk-bifurcation-according-to-gender_fig1_277336300
[FRAM-PA]: https://pubmed.ncbi.nlm.nih.gov/22178898/
[TMA-SVC]: https://teachmeanatomy.info/thorax/vasculature/superior-vena-cava/
[SP-IVC]: https://www.ncbi.nlm.nih.gov/sites/books/NBK482353/
[KH-IVC]: https://www.kenhub.com/en/library/anatomy/inferior-vena-cava
[KH-PV]: https://www.kenhub.com/en/library/anatomy/pulmonary-veins
[KH-PAPV]: https://www.kenhub.com/en/library/anatomy/pulmonary-arteries-and-veins
[PV-VAR-BMC]: https://link.springer.com/article/10.1186/s12872-018-0884-3
[PV-VAR-SRA]: https://link.springer.com/10.1007/s00276-019-02210-1
[PV-VAR-RG]: https://pubs.rsna.org/doi/abs/10.1148/rg.2017170050
[PV-DIAM]: https://pubs.rsna.org/doi/abs/10.1148/radiol.2351032106
[KH-VALVES]: https://www.kenhub.com/en/library/anatomy/heart-valves
[KH-SKEL]: https://www.kenhub.com/en/library/anatomy/cardiac-skeleton
[AO-MITRAL]: https://pmc.ncbi.nlm.nih.gov/articles/PMC4372049/
[HORIZ-AO]: https://eurointervention.pcronline.com/article/tavi-and-horizontal-aorta-a-no-impact-relationship
[EBSTEIN]: https://www.ahajournals.org/doi/10.1161/circulationaha.106.619338
[ANN-CMR]: https://jcmr-online.biomedcentral.com/articles/10.1186/s12968-020-00688-y
[ANN-JACC]: https://www.jacc.org/doi/10.1016/j.jcmg.2017.05.017
[ANN-PATENT]: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10973633
[TMA-PERI]: https://teachmeanatomy.info/thorax/organs/heart/pericardium/
[PERI-CT]: https://pubs.rsna.org/doi/full/10.1148/radiol.13121059
[KH-PERI]: https://www.kenhub.com/en/library/anatomy/the-pericardium
[IMAIOS-NOTCH]: https://www.imaios.com/en/e-anatomy/anatomical-structures/cardiac-notch-of-left-lung-1541213932
[DIAPH]: https://humananatomy.host.dartmouth.edu/BHA/public_html/part_4/chapter_20.html
[LEMOLA2004]: https://www.ahajournals.org/doi/10.1161/01.cir.0000149714.31471.fd
[SANCHEZ2005]: https://www.ahajournals.org/doi/10.1161/circulationaha.105.551291
[IMAIOS-OES]: https://www.imaios.com/en/e-anatomy/anatomical-structures/thoracic-part-of-esophagus-1541093288
[KH-CARINA]: https://www.kenhub.com/en/library/anatomy/carina-of-trachea
[CARINA-ANGLE]: https://pubmed.ncbi.nlm.nih.gov/16110098/
[LT-INTRO]: https://bio.libretexts.org/Courses/West_Hills_College_-_Lemoore/Human_Anatomy_Laboratory_Manual_(Hartline)/17:_Cardiovascular_System_-_The_Heart/17.01:_Introduction
