#!/usr/bin/env node
/**
 * Readest Selection-AI patch applier.
 *
 * Usage:  node patch/apply.mjs <path-to-readest-source-tree>
 *
 * Applies a small, auditable set of anchored edits to an upstream Readest
 * checkout. Every anchor must match exactly once; if upstream changed the
 * surrounding code the script fails loudly instead of silently producing a
 * broken tree. Running it twice is safe (idempotent).
 *
 * Scope: adds a "Ask AI" tool to the text-selection toolbar and a popup that
 * can ask / explain / translate / give a contextual dictionary entry / summarize
 * the selected passage using a USER-CONFIGURED OpenAI-compatible endpoint.
 * It does NOT modify, bypass or unlock any paid translation, quota,
 * subscription or entitlement check in upstream Readest.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || process.cwd());
const here = path.dirname(fileURLToPath(import.meta.url));
const filesDir = path.join(here, 'files');

if (!fs.existsSync(path.join(root, 'apps/readest-app/package.json'))) {
  console.error(`ERROR: ${root} does not look like a Readest source tree.`);
  process.exit(1);
}

let changes = 0;

/**
 * Replace one uniquely-occurring anchor.
 * `patchedMarker` is a string that only exists AFTER the patch was applied;
 * when present the edit is skipped, making the whole script idempotent.
 * Pass `null` to disable the check (caller guards it instead).
 */
function replace(rel, from, to, patchedMarker = to) {
  const abs = path.join(root, rel);
  const src = fs.readFileSync(abs, 'utf8');
  if (patchedMarker && src.includes(patchedMarker)) {
    console.log(`  skip   ${rel} (already patched)`);
    return;
  }
  const occurrences = src.split(from).length - 1;
  if (occurrences === 0) {
    throw new Error(`Anchor NOT FOUND in ${rel}:\n<<<\n${from}\n>>>`);
  }
  if (occurrences !== 1) {
    throw new Error(`Anchor matched ${occurrences} times in ${rel} (need exactly 1):\n<<<\n${from}\n>>>`);
  }
  fs.writeFileSync(abs, src.replace(from, to), 'utf8');
  changes++;
  console.log(`  patch  ${rel}`);
}

function addFile(rel, source) {
  const dest = path.join(root, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, fs.readFileSync(path.join(filesDir, source), 'utf8'), 'utf8');
  changes++;
  console.log(`  add    ${rel}`);
}

console.log(`Applying Selection-AI patch to ${root}`);

// ── 1. A new annotation tool type ────────────────────────────────────────────
const TYPES = 'apps/readest-app/src/types/annotator.ts';
replace(TYPES, "  | 'quotecard';", "  | 'quotecard'\n  | 'ai';");

// ── 2. Toolbar button definition ─────────────────────────────────────────────
const TOOLS = 'apps/readest-app/src/app/reader/components/annotator/AnnotationTools.tsx';
replace(
  TOOLS,
  "import { BsTranslate } from 'react-icons/bs';",
  "import { BsTranslate } from 'react-icons/bs';\nimport { BsStars } from 'react-icons/bs';",
);
replace(
  TOOLS,
  "  {\n    type: 'tts',",
  `  {
    type: 'ai',
    label: _('Ask AI'),
    tooltip: _('Ask AI about the selected text'),
    Icon: BsStars,
    quickAction: true,
  },
  {
    type: 'tts',`,
);

// ── 3. Make the AI tool available AND visible by default ─────────────────────
const TOOLBAR = 'apps/readest-app/src/utils/annotationToolbar.ts';
replace(TOOLBAR, "  'quotecard',\n];", "  'quotecard',\n  'ai',\n];");
replace(TOOLBAR, "  'proofread',\n];", "  'proofread',\n  'ai',\n];");

// ── 4. Annotator wiring ──────────────────────────────────────────────────────
const ANNOTATOR =
  'apps/readest-app/src/app/reader/components/annotator/Annotator.tsx';

replace(
  ANNOTATOR,
  "import TranslatorPopup from './TranslatorPopup';",
  "import TranslatorPopup from './TranslatorPopup';\nimport AIQueryPopup from './AIQueryPopup';",
);

replace(
  ANNOTATOR,
  "  const [showProofreadPopup, setShowProofreadPopup] = useState(false);",
  "  const [showProofreadPopup, setShowProofreadPopup] = useState(false);\n  const [showAIQueryPopup, setShowAIQueryPopup] = useState(false);",
);

replace(
  ANNOTATOR,
  "  const [proofreadPopupPosition, setProofreadPopupPosition] = useState<Position>();",
  "  const [proofreadPopupPosition, setProofreadPopupPosition] = useState<Position>();\n  const [aiQueryPopupPosition, setAIQueryPopupPosition] = useState<Position>();",
);

replace(
  ANNOTATOR,
  `  if (!selection && (showDictionaryPopup || showDeepLPopup || showProofreadPopup)) {
    setShowDictionaryPopup(false);
    setShowDeepLPopup(false);
    setShowProofreadPopup(false);
  }`,
  `  if (!selection && (showDictionaryPopup || showDeepLPopup || showProofreadPopup || showAIQueryPopup)) {
    setShowDictionaryPopup(false);
    setShowDeepLPopup(false);
    setShowProofreadPopup(false);
    setShowAIQueryPopup(false);
  }`,
);

replace(
  ANNOTATOR,
  "  const showingPopup =\n    showAnnotPopup || showDictionaryPopup || showDeepLPopup || showProofreadPopup;",
  "  const showingPopup =\n    showAnnotPopup || showDictionaryPopup || showDeepLPopup || showProofreadPopup || showAIQueryPopup;",
);

replace(
  ANNOTATOR,
  "  const proofreadPopupHeight = Math.min(200, maxHeight);",
  "  const proofreadPopupHeight = Math.min(200, maxHeight);\n  const aiQueryPopupWidth = Math.min(520, maxWidth);\n  const aiQueryPopupHeight = Math.min(420, maxHeight);",
);

replace(
  ANNOTATOR,
  `    const proofreadPopupPos = getPopupPosition(
      triangPos,
      rect,
      proofreadPopupWidth,
      proofreadPopupHeight,
      popupPadding,
    );
    if (triangPos.point.x == 0 || triangPos.point.y == 0) return;`,
  `    const proofreadPopupPos = getPopupPosition(
      triangPos,
      rect,
      proofreadPopupWidth,
      proofreadPopupHeight,
      popupPadding,
    );
    const aiQueryPopupPos = getPopupPosition(
      triangPos,
      rect,
      aiQueryPopupWidth,
      aiQueryPopupHeight,
      popupPadding,
    );
    if (triangPos.point.x == 0 || triangPos.point.y == 0) return;`,
);

replace(
  ANNOTATOR,
  "    setProofreadPopupPosition(offsetPosition(proofreadPopupPos, origin));\n    setTrianglePosition(offsetPosition(triangPos, origin));",
  "    setProofreadPopupPosition(offsetPosition(proofreadPopupPos, origin));\n    setAIQueryPopupPosition(offsetPosition(aiQueryPopupPos, origin));\n    setTrianglePosition(offsetPosition(triangPos, origin));",
);

replace(
  ANNOTATOR,
  "      setShowDictionaryPopup(false);\n      setShowDeepLPopup(false);\n      setShowProofreadPopup(false);\n      setEditingAnnotation(null);",
  "      setShowDictionaryPopup(false);\n      setShowDeepLPopup(false);\n      setShowProofreadPopup(false);\n      setShowAIQueryPopup(false);\n      setEditingAnnotation(null);",
);

replace(
  ANNOTATOR,
  "    setShowDeepLPopup(false);\n    setShowDictionaryPopup(false);\n    setShowProofreadPopup(false);\n  };",
  "    setShowDeepLPopup(false);\n    setShowDictionaryPopup(false);\n    setShowProofreadPopup(false);\n    setShowAIQueryPopup(false);\n  };",
);

// Long-press quick action can be assigned to "Ask AI" too.
replace(
  ANNOTATOR,
  `        case 'tts':
          handleSpeakText(true);
          break;
        case 'share':
          handleShare();
          break;
      }`,
  `        case 'tts':
          handleSpeakText(true);
          break;
        case 'ai':
          handleAIQuery();
          break;
        case 'share':
          handleShare();
          break;
      }`,
);

// Popup opener, next to the existing translation opener.
replace(
  ANNOTATOR,
  `  const handleTranslation = () => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    void suppressNativeSelectionHandles();
    setShowDeepLPopup(true);
  };`,
  `  const handleTranslation = () => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    void suppressNativeSelectionHandles();
    setShowDeepLPopup(true);
  };

  // Selection AI: opens a self-contained popup that talks only to the
  // OpenAI-compatible endpoint the reader configured. No entitlement checks.
  const handleAIQuery = () => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    void suppressNativeSelectionHandles();
    setShowDictionaryPopup(false);
    setShowDeepLPopup(false);
    setShowProofreadPopup(false);
    setShowAIQueryPopup(true);
  };`,
);

// Toolbar button handler.
replace(
  ANNOTATOR,
  "      case 'translate':\n        return { tooltipText: _(label), Icon, onClick: handleTranslation };\n      case 'tts':",
  "      case 'translate':\n        return { tooltipText: _(label), Icon, onClick: handleTranslation };\n      case 'ai':\n        return { tooltipText: _(label), Icon, onClick: handleAIQuery };\n      case 'tts':",
);

// Keep range-editor handles below the AI popup, like the other lookup popups.
replace(
  ANNOTATOR,
  "  const overlaySurfaceOpen =\n    showDictionaryPopup || showDeepLPopup || showProofreadPopup || !!noteEditorTarget;",
  "  const overlaySurfaceOpen =\n    showDictionaryPopup || showDeepLPopup || showProofreadPopup || showAIQueryPopup || !!noteEditorTarget;",
);

// Mount the popup. `sentenceAt` is already imported upstream and gives the
// contextual dictionary the surrounding sentence.
replace(
  ANNOTATOR,
  "      {!editingAnnotation &&\n        !overlaySurfaceOpen &&",
  `      {showAIQueryPopup && trianglePosition && aiQueryPopupPosition && selection && (
        <AIQueryPopup
          text={selection.text}
          context={(selection.range && sentenceAt(selection.range)) || selection.text}
          bookTitle={bookData.book?.title}
          position={aiQueryPopupPosition}
          trianglePosition={trianglePosition}
          popupWidth={aiQueryPopupWidth}
          popupHeight={aiQueryPopupHeight}
          onDismiss={handleDismissPopupShowToolbar}
        />
      )}
      {!editingAnnotation &&
        !overlaySurfaceOpen &&`,
);

// ── 5. Drop the Sentry sourcemap upload from the local/Tauri build command. ──
// Upstream CI has SENTRY_AUTH_TOKEN; a fork usually does not, and the upload
// step can fail the whole Android build. This changes nothing at runtime.
const TAURI_CONF = 'apps/readest-app/src-tauri/tauri.conf.json';
const tauriConfSrc = fs.readFileSync(path.join(root, TAURI_CONF), 'utf8');
if (tauriConfSrc.includes('pnpm build && pnpm upload-sourcemaps')) {
  replace(
    TAURI_CONF,
    '"beforeBuildCommand": "pnpm build && pnpm upload-sourcemaps"',
    '"beforeBuildCommand": "pnpm build"',
    null,
  );
} else {
  console.log(`  skip   ${TAURI_CONF} (already patched)`);
}

// ── 6. New source files ──────────────────────────────────────────────────────
addFile('apps/readest-app/src/services/ai/selectionQuery.ts', 'selectionQuery.ts');
addFile(
  'apps/readest-app/src/app/reader/components/annotator/AIQueryPopup.tsx',
  'AIQueryPopup.tsx',
);

console.log(`Done. ${changes} file(s) written.`);
