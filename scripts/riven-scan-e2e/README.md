# Riven OCR tests

After `corepack pnpm run build:main`, run:

```sh
node scripts/hidden-desktop.mjs node scripts/riven-scan-e2e/run-check.cjs
```

Runs the production crop, YOLO/PaddleOCR, parser, confidence gate and weapon-panel
reader in an isolated Electron process. Missing fixtures or models and host crashes
fail the run. On failure, the console prints the directory containing stdout,
stderr, OCR results and the test profile.

The fixture is `assets/setup/overlay-demo-riven.jpg` (1920x1080). Expected results:

- Fire Rate +72.7%, Weapon Recoil -66.2%, Multishot +85.7%, Status Duration -65.1%.
- Weapon Recoil is a beneficial negative value; Status Duration is the curse.
- The linked weapon is Kuva Sobek, although the card title says Sobek.

Both initial-card and roll-card crops must retain all four stats. A generated
blank frame must produce neither stats nor a weapon. The Angstrum crop tests
cover curse detection on a small card.

Full-frame coverage is limited to this screenshot. Chat-linked cards, choice
screens, lower interface scales and windowed captures still need fixtures.
Live capture and event timing require separate tests.
