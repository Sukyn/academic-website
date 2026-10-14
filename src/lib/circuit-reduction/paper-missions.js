// Transcribed from pages 10–11 of public/outreach/jeu-circuits-quantiques.pdf.
// Preserve printed gate order. Each stage enables the shortcuts already proved.
import { PAPER_CERTIFICATES } from './paper-certificates.js';
import { decodeCircuit } from './stored-puzzles.js';
const oneWire = ['slide-h', 'slide-x', 'cancel-h', 'cancel-x'];
const changeBasis = [...oneWire, 'basis-x'];
const derivedBasis = [...changeBasis, 'basis-z'];
const phasesLearned = [...derivedBasis, 'cancel-z'];
const entanglement = [...phasesLearned, 'cancel-cnot-down', 'basis-down'];
const upperTargets = [...entanglement, 'cancel-cz', 'basis-up'];
const controls = [...upperTargets, 'cancel-cnot-up'];
const phases = [...controls, 'phase-up', 'phase-down'];
const order = [...phases, 'control-order'];
const transfer = [...order, 'transfer'];
const corners = [...transfer, 'corner-up', 'corner-down'];
const stabilizers = [...corners, 'stabilizer-up', 'stabilizer-down'];
const mission = (sourceMission, title, text, allowedRules, certificateKey = sourceMission) => ({
  sourceMission, title, circuit: decodeCircuit(text), allowedRules, ...PAPER_CERTIFICATES[certificateKey],
});

export const PAPER_MISSIONS = [
  mission(1, 'Inside the Hadamards', 'H X X H', oneWire),
  mission(2, 'A different basis', 'Z H X H', changeBasis),
  mission(3, 'Two phases', 'Z Z', derivedBasis),
  mission(4, 'Entanglement in disguise', 'ZU ZU / ZD ZD', entanglement),
  mission(5, 'Linked changes of basis', 'ZU H XU Z H X / ZD . ZD . . .', controls),
  mission(6, 'Expand to simplify', 'XU X H Z ZU H / ZD . . . ZD .', controls),
  mission(7, 'Reverse the controls', '. XU ZU H XU ZU H / H ZD XD H ZD XD .', controls),
  mission(8, 'A hidden identity', 'H ZU X ZU H XU Z XU / . ZD . ZD . ZD . ZD', controls),
  // Teach phase commutation before the paper's overlapping-control missions.
  mission(11, 'Commute a phase', '. XU . XU / Z ZD Z ZD', phases),
  mission(9, 'Order of controls', '. XU . XU / ZU ZD ZU ZD / XD . XD .', order),
  mission(10, 'Transfer the targets', 'ZU XU ZU XU ZU XU / XD ZD XD ZD XD ZD', transfer),
  mission(12, 'Commute a target flip', 'X XU X XU / . ZD . ZD', transfer),
  mission(13, 'Change the corner', '. XU ZU XU ZU / Z ZD ZD ZD ZD', corners),
  mission(14, 'Propagate a flip', 'Z XU Z XU . / . ZD . ZD Z', stabilizers),
  mission(15, 'Transfer a phase', 'ZU XU ZU Z ZU XU ZU . / XD ZD XD . XD ZD XD Z', stabilizers),
  mission(16, 'Transfer a flip', '. ZU XU ZU X ZU XU ZU / X XD ZD XD . XD ZD XD', stabilizers),
];

// The paper gives this second starting board for mission 4.
export const PAPER_MISSION_FOUR_ALTERNATIVE = mission(4, 'Upper targets in disguise',
  'XU XU / ZD ZD', upperTargets, '4-upper');

// Focused constructed identities introduce each advanced rule before combining it.
export const PAPER_RULE_INTRODUCTIONS = [
  { ...mission(null, 'Move a control phase', 'Z ZU Z ZU / . XD . XD', phases, 'intro-phase'), introKey: 'phase' },
  { ...mission(null, 'Overlapping controls', '. ZU . ZU / ZU ZD ZU ZD / ZD . ZD .', order, 'intro-order'), introKey: 'order' },
  { ...mission(null, 'A flip leaves a phase', 'X ZU X ZU . / . ZD . ZD Z', stabilizers, 'intro-stabilizer'), introKey: 'stabilizer' },
];
